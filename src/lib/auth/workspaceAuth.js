// RBAC helpers for dashboard route handlers. JWT `activeWorkspaceId`/`role`
// are cache hints only — every check here re-reads membership from DB before
// authorizing, per docs/CUSTOM_HOOKS.md ("JWT role is never authoritative").
import { NextResponse } from "next/server";
import { getDashboardAuthSession } from "./dashboardSession.js";
import { getUserById, toPublicUser } from "@/lib/db/repos/usersRepo.js";
import { getMember } from "@/lib/db/repos/workspacesRepo.js";
import { WORKSPACE_ROLES, hasWorkspaceRole, DEFAULT_WORKSPACE_ID } from "@/lib/workspaces/constants.js";

function unauthorized(message = "Unauthorized") {
  return { error: NextResponse.json({ error: message }, { status: 401 }) };
}

function forbidden(message = "Forbidden") {
  return { error: NextResponse.json({ error: message }, { status: 403 }) };
}

// Resolves the real, currently-active user for a dashboard request.
// Returns { error } on failure, else { user, session }.
export async function requireUser(request) {
  const token = request.cookies.get("auth_token")?.value;
  const session = await getDashboardAuthSession(token);
  if (!session?.userId) return unauthorized();
  const user = await getUserById(session.userId);
  if (!user || user.isActive === false) return unauthorized();
  return { user: toPublicUser(user), session };
}

// Resolves the user AND verifies workspace membership meets minimumRole,
// re-read from DB. Returns { error } on failure, else { user, session, member }.
export async function requireWorkspaceRole(request, workspaceId, minimumRole = WORKSPACE_ROLES.MEMBER) {
  const base = await requireUser(request);
  if (base.error) return base;
  if (!workspaceId) return forbidden("Workspace required");
  const member = await getMember(workspaceId, base.user.id);
  if (!member || !hasWorkspaceRole(member.role, minimumRole)) return forbidden();
  return { ...base, member };
}

// Shorthand for system-level actions (global settings, pricing) gated to the
// owner of the Default workspace.
export async function requireDefaultOwner(request) {
  return requireWorkspaceRole(request, DEFAULT_WORKSPACE_ID, WORKSPACE_ROLES.OWNER);
}
