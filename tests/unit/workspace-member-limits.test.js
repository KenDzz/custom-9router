import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let users;
let workspaces;
let memberAccess;
let apiKeys;
let usage;
let requestContext;
let owner;
let member;
let workspace;
let memberKey;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-member-limits-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  users = await import("@/lib/db/repos/usersRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  memberAccess = await import("@/lib/db/repos/memberAccessRepo.js");
  apiKeys = await import("@/lib/db/repos/apiKeysRepo.js");
  usage = await import("@/lib/db/repos/usageRepo.js");
  requestContext = await import("@/lib/workspaces/requestContext.js");
  await db.initDb();
  owner = await users.createUser({ username: "limit-owner", email: "limit-owner@example.com" });
  member = await users.createUser({ username: "limit-member", email: "limit-member@example.com" });
  workspace = await workspaces.createWorkspace("Limits", owner.id);
  await workspaces.addMember(workspace.id, member.id, "member");
});

afterAll(async () => {
  await db?.closeDb?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("workspace member daily token limits", () => {
  it("sets a quota when adding a member and preserves it when no new quota is supplied", async () => {
    const added = await users.createUser({ username: "new-limited-member", email: "new-limited@example.com" });
    await workspaces.addMember(workspace.id, added.id, "member", { dailyTokenLimit: 1_250_000 });
    expect((await workspaces.getMember(workspace.id, added.id)).dailyTokenLimit).toBe(1_250_000);
    expect(await memberAccess.getMemberTokenStatus(workspace.id, added.id)).toMatchObject({
      dailyTokenLimit: 1_250_000,
      remainingTokens: 1_250_000,
    });

    await workspaces.addMember(workspace.id, added.id, "admin");
    expect(await workspaces.getMember(workspace.id, added.id)).toMatchObject({
      role: "admin",
      dailyTokenLimit: 1_250_000,
    });

    await workspaces.addMember(workspace.id, added.id, "member", { dailyTokenLimit: 0 });
    expect((await workspaces.getMember(workspace.id, added.id)).dailyTokenLimit).toBe(0);
  });

  it("attributes API keys to their creating member", async () => {
    const key = await requestContext.runWithWorkspace(
      { workspaceId: workspace.id, userId: member.id },
      () => apiKeys.createApiKey("member key", "test-machine", member.id),
    );
    memberKey = key;
    expect(await apiKeys.resolveApiKey(key.key)).toMatchObject({
      workspaceId: workspace.id,
      userId: member.id,
    });
  });

  it("aggregates actual daily usage and reports remaining tokens", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 100);
    await requestContext.runWithWorkspace(
      { workspaceId: workspace.id, userId: member.id },
      () => usage.saveRequestUsage({
        timestamp: new Date().toISOString(),
        provider: "test",
        model: "test-model",
        tokens: { prompt_tokens: 60, completion_tokens: 20 },
        apiKey: "member-test-key",
      }),
    );
    expect(await memberAccess.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      dailyTokenLimit: 100,
      usedTokens: 80,
      remainingTokens: 20,
      limitReached: false,
    });
  });

  it("marks the member as limited once actual usage reaches the allowance", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 80);
    expect(await memberAccess.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      dailyTokenLimit: 80,
      usedTokens: 80,
      remainingTokens: 0,
      limitReached: true,
    });
  });

  it("keeps owners unlimited", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, owner.id, 1);
    expect(await memberAccess.getMemberTokenStatus(workspace.id, owner.id)).toMatchObject({
      role: "owner",
      dailyTokenLimit: 0,
      limitReached: false,
    });
  });

  it("blocks exhausted LLM requests before executing the provider callback", async () => {
    const callback = vi.fn(() => Response.json({ ok: true }));
    const request = {
      method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }),
      nextUrl: new URL("http://localhost/api/v1/chat/completions"),
    };
    const response = await requestContext.withLlmWorkspace(request, callback);
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("daily_token_limit_reached");
    expect(callback).not.toHaveBeenCalled();
  });

  it("allows overlapping streams from multiple keys of the same capped member", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 1000);
    const request = {
      method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }),
      nextUrl: new URL("http://localhost/api/v1/chat/completions"),
    };
    const secondKey = await requestContext.runWithWorkspace({ workspaceId: workspace.id },
      () => apiKeys.createApiKey("parallel key", "test-machine", member.id));
    const upstreams = [];
    const callback = () => new Response(new ReadableStream({
      start(controller) { upstreams.push(controller); controller.enqueue(new TextEncoder().encode("first")); },
    }));
    const responses = await Promise.all([
      requestContext.withLlmWorkspace(request, callback),
      requestContext.withLlmWorkspace({ ...request, headers: new Headers({ authorization: `Bearer ${secondKey.key}` }) }, callback),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    upstreams.forEach((controller) => controller.close());
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["first", "first"]);
    const next = await requestContext.withLlmWorkspace(request, () => Response.json({ ok: true }));
    expect(next.status).toBe(200);
    await next.json();
  });

  it("counts identical simultaneous requests separately, deduplicates their own writes, and blocks new calls at the limit", async () => {
    const parallelMember = await users.createUser({ username: "parallel-member" });
    await workspaces.addMember(workspace.id, parallelMember.id, "member", { dailyTokenLimit: 10 });
    const key = await requestContext.runWithWorkspace({ workspaceId: workspace.id },
      () => apiKeys.createApiKey("parallel member key", "test-machine", parallelMember.id));
    const request = { method: "POST", headers: new Headers({ authorization: `Bearer ${key.key}` }) };
    const entry = { timestamp: new Date().toISOString(), model: "identical-request", apiKey: key.key, tokens: { prompt_tokens: 5, completion_tokens: 3 } };
    let proceed;
    let entered;
    let count = 0;
    const gate = new Promise((resolve) => { proceed = resolve; });
    const bothEntered = new Promise((resolve) => { entered = resolve; });
    const callback = async () => {
      if (++count === 2) entered();
      await gate;
      await Promise.all([usage.saveRequestUsage(entry), usage.saveRequestUsage(entry)]);
      return Response.json({ ok: true });
    };
    const pending = Promise.all([
      requestContext.withLlmWorkspace(request, callback),
      requestContext.withLlmWorkspace(request, callback),
    ]);
    await bothEntered;
    proceed();
    const responses = await pending;
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await Promise.all(responses.map((response) => response.json()));
    expect(await memberAccess.getMemberTokenStatus(workspace.id, parallelMember.id)).toMatchObject({ usedTokens: 16, requests: 2, limitReached: true });
    const next = vi.fn(() => Response.json({ ok: true }));
    const blocked = await requestContext.withLlmWorkspace(request, next);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("daily_token_limit_reached");
    expect(next).not.toHaveBeenCalled();
  });

  it("prevents a member from reading or deleting another member's key", async () => {
    await requestContext.runWithWorkspace({ workspaceId: workspace.id }, async () => {
      const key = await apiKeys.createApiKey("owner private key", "test-machine", owner.id);
      expect(await apiKeys.getApiKeyById(key.id, { userId: member.id })).toBeNull();
      expect(await apiKeys.deleteApiKey(key.id, { userId: member.id })).toBe(false);
      expect(await apiKeys.getApiKeyById(key.id, { userId: owner.id })).not.toBeNull();
    });
  });

  it("rolls back all profile changes when the last owner would be demoted", async () => {
    const { updateMemberProfile } = await import("@/lib/db/repos/memberManagementRepo.js");
    const before = await users.getUserById(owner.id);
    await expect(updateMemberProfile(workspace.id, owner.id, {
      displayName: "Should not persist", role: "member", dailyTokenLimit: 42,
    })).rejects.toThrow("last owner");
    expect((await users.getUserById(owner.id)).displayName).toBe(before.displayName);
    expect((await workspaces.getMember(workspace.id, owner.id)).role).toBe("owner");
  });

  it("deactivates a member's keys when membership is removed", async () => {
    const removable = await users.createUser({ username: "removed-member", email: "removed@example.com" });
    await workspaces.addMember(workspace.id, removable.id, "member");
    const key = await requestContext.runWithWorkspace(
      { workspaceId: workspace.id, userId: removable.id },
      () => apiKeys.createApiKey("removed key", "test-machine", removable.id),
    );
    await workspaces.removeMember(workspace.id, removable.id);
    expect(await apiKeys.resolveApiKey(key.key)).toBeNull();
  });

  it("updates profile, password and workspace quota together", async () => {
    const { updateMemberProfile } = await import("@/lib/db/repos/memberManagementRepo.js");
    const bcrypt = (await import("bcryptjs")).default;
    await updateMemberProfile(workspace.id, member.id, {
      displayName: "Updated Member", dailyTokenLimit: 150, newPassword: "NewSecurePassword123!",
    }, owner.id);
    const updated = await users.getUserById(member.id);
    expect(updated.displayName).toBe("Updated Member");
    expect(await bcrypt.compare("NewSecurePassword123!", updated.passwordHash)).toBe(true);
    expect(users.toPublicUser(updated)).not.toHaveProperty("passwordHash");
    expect((await workspaces.getMember(workspace.id, member.id)).dailyTokenLimit).toBe(150);
  });

  it("does not let a workspace owner reset an owner account in another workspace", async () => {
    const { updateMemberProfile } = await import("@/lib/db/repos/memberManagementRepo.js");
    const other = await workspaces.createWorkspace("Other owned workspace", member.id);
    await expect(updateMemberProfile(workspace.id, member.id, { newPassword: "TakeoverPassword123!" }, owner.id))
      .rejects.toThrow("owner in another workspace");
    await updateMemberProfile(workspace.id, member.id, { dailyTokenLimit: 200 }, owner.id);
    expect((await workspaces.getMember(workspace.id, member.id)).dailyTokenLimit).toBe(200);
    expect((await workspaces.getMember(other.id, member.id)).role).toBe("owner");
  });

  it("preserves member key ownership when exporting and restoring a workspace", async () => {
    await requestContext.runWithWorkspace({ workspaceId: workspace.id, userId: owner.id }, async () => {
      const payload = await db.exportDb({ includeGlobal: false });
      expect(payload.apiKeys.find((key) => key.id === memberKey.id).userId).toBe(member.id);
      await db.importDb(payload, { includeGlobal: false });
      expect((await apiKeys.resolveApiKey(memberKey.key)).userId).toBe(member.id);
    });
  });

  it("does not count yesterday's usage or another workspace's usage", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    adapter.run("INSERT INTO usageHistory(workspaceId, userId, timestamp, promptTokens) VALUES(?, ?, ?, ?)",
      [workspace.id, member.id, yesterday.toISOString(), 9000]);
    adapter.run("INSERT INTO usageHistory(workspaceId, userId, timestamp, promptTokens) VALUES(?, ?, ?, ?)",
      ["other-workspace", member.id, new Date().toISOString(), 9000]);
    expect((await memberAccess.getMemberTokenStatus(workspace.id, member.id)).usedTokens).toBe(80);
  });

  it("returns 401 for an unknown key instead of running the provider", async () => {
    const callback = vi.fn();
    const response = await requestContext.withLlmWorkspace({ method: "POST", headers: new Headers({ authorization: "Bearer unknown-key" }) }, callback);
    expect(response.status).toBe(401);
    expect(callback).not.toHaveBeenCalled();
  });

  it("allows metadata reads after the daily allowance is exhausted", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 1);
    const response = await requestContext.withLlmWorkspace({
      method: "GET", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }),
    }, () => Response.json({ data: [] }));
    expect(response.status).toBe(200);
  });

  it("forwards client cancellation and allows subsequent requests", async () => {
    await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 1000);
    const request = { method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }) };
    const cancelled = vi.fn();
    const response = await requestContext.withLlmWorkspace(request, () => new Response(new ReadableStream({ cancel: cancelled })));
    await response.body.cancel();
    expect(cancelled).toHaveBeenCalled();
    const next = await requestContext.withLlmWorkspace(request, () => Response.json({ ok: true }));
    expect(next.status).toBe(200);
    await next.json();
  });

  it("does not let a signed-in local member bypass quotas by omitting the API key", async () => {
    const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession.js");
    const { NextRequest } = await import("next/server");
    const token = await createDashboardAuthToken({ userId: member.id, activeWorkspaceId: workspace.id });
    const request = new NextRequest("http://localhost/v1/chat/completions", {
      method: "POST", headers: { host: "localhost", cookie: `auth_token=${token}` },
    });
    const callback = vi.fn();
    expect((await requestContext.withLlmWorkspace(request, callback)).status).toBe(401);
    expect(callback).not.toHaveBeenCalled();
  });

  it("charges usage reported by JSON endpoints without a chat usage collector", async () => {
    const before = await memberAccess.getMemberTokenStatus(workspace.id, member.id);
    const request = {
      method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }),
      nextUrl: new URL("http://localhost/v1/embeddings"),
    };
    const response = await requestContext.withLlmWorkspace(request, () => Response.json({
      model: "embedding-fixture", data: [], usage: { prompt_tokens: 12, total_tokens: 12 },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).usage.prompt_tokens).toBe(12);
    expect((await memberAccess.getMemberTokenStatus(workspace.id, member.id)).usedTokens).toBe(before.usedTokens + 12);
  });

  it("does not charge JSON usage twice when upstream already collected it", async () => {
    const before = await memberAccess.getMemberTokenStatus(workspace.id, member.id);
    const request = { method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }) };
    const response = await requestContext.withLlmWorkspace(request, async () => {
      await usage.saveRequestUsage({ model: "collected-fixture", tokens: { prompt_tokens: 15, completion_tokens: 7 } });
      return Response.json({ model: "collected-fixture", usage: { prompt_tokens: 15, completion_tokens: 7 } });
    });
    await response.json();
    expect((await memberAccess.getMemberTokenStatus(workspace.id, member.id)).usedTokens).toBe(before.usedTokens + 22);
  });

  it("treats total_tokens as the total, not extra input tokens", async () => {
    const before = await memberAccess.getMemberTokenStatus(workspace.id, member.id);
    const request = { method: "POST", headers: new Headers({ authorization: `Bearer ${memberKey.key}` }) };
    const response = await requestContext.withLlmWorkspace(request, () => Response.json({ usage: { total_tokens: 30, output_tokens: 10 } }));
    await response.json();
    expect((await memberAccess.getMemberTokenStatus(workspace.id, member.id)).usedTokens).toBe(before.usedTokens + 30);
  });
});
