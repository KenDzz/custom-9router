// Per-request workspace context. AsyncLocalStorage, not a mutable global —
// concurrent requests (including concurrent LLM streams) never cross-read
// each other's workspaceId. See docs/CUSTOM_HOOKS.md.
import { AsyncLocalStorage } from "node:async_hooks";
import { acquireMemberPermit, finishMemberUsage, keepPermitUntilResponseEnds } from "./memberQuota.js";
import { recordUntrackedMemberUsage } from "./memberUsage.js";
import { authorizeModelRequest, filterModelCatalog } from "./modelAccess.js";

const als = new AsyncLocalStorage();

export function runWithWorkspace(context, callback) {
  if (!context?.workspaceId) throw new Error("runWithWorkspace: workspaceId required");
  return als.run(context, callback);
}

// Test-only convenience: sets the store for the rest of the current sync
// execution and every async continuation spawned from it (unlike `run`,
// doesn't wrap a single callback) — meant for a `beforeEach`/`beforeAll`
// hook so an entire test file/describe block shares one workspace context,
// instead of every `it()` body being wrapped in `runWithWorkspace(...)`.
export function enterWorkspaceForTest(context) {
  if (!context?.workspaceId) throw new Error("enterWorkspaceForTest: workspaceId required");
  als.enterWith(context);
}

export function getWorkspaceContext() {
  return als.getStore() || null;
}

// Fail closed: any repo call that forgets to run inside a workspace context
// throws immediately rather than silently touching the wrong (or no) data.
export function requireWorkspaceId() {
  const ctx = als.getStore();
  if (!ctx?.workspaceId) throw new Error("requireWorkspaceId: no workspace context on this request");
  return ctx.workspaceId;
}

// ─── Boundary wrappers ───────────────────────────────────────────────────
// Both resolve workspace identity from a trusted source (JWT+DB membership,
// or the API key row) and never from a client-suppliable header.

// Dashboard routes: JWT's activeWorkspaceId, re-verified against DB
// membership (JWT role is never trusted). Returns whatever `callback` returns
// on success; returns the auth error response itself on failure — callers
// return the result directly (`return await withDashboardWorkspace(...)`).
export async function withDashboardWorkspace(request, minimumRole, callback) {
  const { requireUser } = await import("@/lib/auth/workspaceAuth.js");
  const { getMember } = await import("@/lib/db/repos/workspacesRepo.js");
  const { hasWorkspaceRole } = await import("./constants.js");

  const base = await requireUser(request);
  if (base.error) return base.error;
  const workspaceId = base.session?.activeWorkspaceId;
  const member = workspaceId ? await getMember(workspaceId, base.user.id) : null;
  if (!member || !hasWorkspaceRole(member.role, minimumRole)) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return runWithWorkspace({ workspaceId, userId: base.user.id }, () => callback({ ...base, member }));
}

// LLM API routes (/v1/*, /v1beta/*, Codex): resolves workspace from the API
// key itself. Local/CLI requests with no key fall back to Default — never
// from a header. See docs/CUSTOM_HOOKS.md.
export async function withLlmWorkspace(request, callback) {
  const { extractApiKey, isLocalRequest } = await import("@/dashboardGuard.js");
  const { resolveApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
  const { DEFAULT_WORKSPACE_ID } = await import("./constants.js");

  const key = extractApiKey(request);
  let context;
  let releasePermit;
  let trackMemberUsage = false;
  if (key) {
    const resolved = await resolveApiKey(key);
    if (!resolved) return Response.json({ error: "Invalid or inactive API key" }, { status: 401 });
    if (resolved.userId) {
      const { getMemberTokenStatus } = await import("@/lib/db/repos/memberAccessRepo.js");
      let tokenStatus = await getMemberTokenStatus(resolved.workspaceId, resolved.userId);
      if (!tokenStatus) {
        return Response.json({ error: "API key owner is no longer a workspace member" }, { status: 403 });
      }
      const billable = request.method === "POST";
      trackMemberUsage = tokenStatus.role !== "owner";
      if (billable && tokenStatus.dailyTokenLimit > 0) {
        releasePermit = acquireMemberPermit(resolved.workspaceId, resolved.userId);
        if (!releasePermit) {
          return Response.json({ error: "Another request is still using this member's allowance", code: "member_request_in_progress" },
            { status: 429, headers: { "Retry-After": "1" } });
        }
        try {
          tokenStatus = await getMemberTokenStatus(resolved.workspaceId, resolved.userId);
        } catch (error) {
          releasePermit();
          throw error;
        }
        if (!tokenStatus) {
          releasePermit();
          return Response.json({ error: "API key owner is no longer a workspace member" }, { status: 403 });
        }
      }
      if (billable && tokenStatus.limitReached) {
        releasePermit?.();
        return Response.json({
          error: "Daily token limit reached",
          code: "daily_token_limit_reached",
          limit: tokenStatus.dailyTokenLimit,
          used: tokenStatus.usedTokens,
          resetsAt: tokenStatus.resetsAt,
        }, { status: 429 });
      }
    }
    context = {
      workspaceId: resolved.workspaceId,
      apiKeyId: resolved.apiKeyId,
      userId: resolved.userId || null,
      trackMemberUsage,
      ...(releasePermit ? { pendingUsageWrites: new Set() } : {}),
    };
  } else if (isLocalRequest(request)) {
    const token = request.cookies?.get("auth_token")?.value;
    if (token) {
      const { requireDefaultOwner } = await import("@/lib/auth/workspaceAuth.js");
      const auth = await requireDefaultOwner(request);
      if (auth.error) return Response.json({ error: "An API key is required for this account" }, { status: 401 });
    }
    context = { workspaceId: DEFAULT_WORKSPACE_ID };
  } else {
    return Response.json({ error: "API key required" }, { status: 401 });
  }
  try {
    const { access, error } = await runWithWorkspace(context, () => authorizeModelRequest(request, context));
    if (error) {
      releasePermit?.();
      return error;
    }
    const response = await runWithWorkspace(context, async () => {
      const result = await callback(context);
      await recordUntrackedMemberUsage(request, result, context);
      return filterModelCatalog(request, result, access);
    });
    return releasePermit ? await keepPermitUntilResponseEnds(response, context, releasePermit) : response;
  } catch (error) {
    if (releasePermit) await finishMemberUsage(context, releasePermit);
    throw error;
  }
}

// Shared dashboard/LLM utility endpoints (for example TTS voice catalogs)
// can be reached by the signed-in dashboard or through /v1 with an API key.
// Reuse an existing context for in-process calls, otherwise select the trusted
// boundary based on whether the request carries a dashboard session cookie.
export async function withDashboardOrLlmWorkspace(request, minimumRole, callback) {
  const current = getWorkspaceContext();
  if (current) return callback(current);
  if (request.cookies.get("auth_token")?.value) {
    return withDashboardWorkspace(request, minimumRole, callback);
  }
  return withLlmWorkspace(request, callback);
}
