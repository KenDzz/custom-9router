import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ sessions: new Map() }));
vi.mock("@/lib/auth/dashboardSession.js", () => ({ getDashboardAuthSession: vi.fn(async (token) => auth.sessions.get(token)) }));
const originalDataDir = process.env.DATA_DIR;
let dir, db, context, policies, combos, aliases, workspaces, owner, member, workspace, other, combo, key, adapter, routes;
let NextRequest;
const restricted = (models = [], comboIds = []) => ({ mode: "restricted", models, comboIds });
const scope = (callback, workspaceId = workspace.id) => context.runWithWorkspace({ workspaceId, userId: member.id }, callback);
const snapshot = async () => {
  const access = await scope(() => policies.getModelAccessSnapshot(member.id));
  return { ...access, allows: (...args) => scope(() => access.allows(...args)) };
};
function request(url, body, options = {}) {
  return new Request(`http://localhost:20127${url}`, { method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json", ...options.headers }, body: JSON.stringify(body), ...options });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-access-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  context = await import("@/lib/workspaces/requestContext.js");
  policies = await import("@/lib/db/repos/modelAccessRepo.js");
  combos = await import("@/lib/db/repos/combosRepo.js");
  aliases = await import("@/lib/db/repos/aliasRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  const users = await import("@/lib/db/repos/usersRepo.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  owner = await users.createUser({ username: "model-owner" });
  member = await users.createUser({ username: "model-member" });
  workspace = await workspaces.createWorkspace("Models", owner.id);
  other = await workspaces.createWorkspace("Other", owner.id);
  await workspaces.addMember(workspace.id, member.id, "member");
  await workspaces.updateMemberDailyTokenLimit(workspace.id, member.id, 10000);
  combo = await scope(() => combos.createCombo({ name: "allowed-combo", models: ["openai/gpt-4o"] }));
  key = await scope(() => db.createApiKey("member key", "test", member.id));
  routes = await import("@/lib/workspaces/modelAccessRoutes.js");
  ({ NextRequest } = await import("next/server"));
  auth.sessions.set("owner", { userId: owner.id, activeWorkspaceId: workspace.id });
  auth.sessions.set("member", { userId: member.id, activeWorkspaceId: workspace.id, role: "owner" });
});
beforeEach(async () => {
  await workspaces.updateMemberRole(workspace.id, member.id, "member");
  await scope(async () => {
    await policies.saveWorkspaceModelAccess({ mode: "all" });
    await policies.saveMemberModelAccess(member.id, { mode: "inherit" });
    await combos.updateCombo(combo.id, { name: "allowed-combo" });
  });
});
afterAll(async () => {
  await db?.closeDb();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});

describe("model access policies", () => {
  it("keeps legacy workspaces unrestricted when no policy exists", async () => {
    const access = await scope(() => policies.getModelAccessSnapshot(), other.id);
    expect(access.restricted).toBe(false);
    expect(await access.allows("anything/new-model")).toBe(true);
  });
  it("canonicalizes provider aliases and bare model IDs", async () => {
    const policy = await scope(() => policies.saveWorkspaceModelAccess(restricted(["cx/gpt-4o", "codex/gpt-4o", "gpt-4o"])));
    expect(policy.models).toEqual(["codex/gpt-4o", "openai/gpt-4o"]);
    const access = await snapshot();
    expect(await access.allows("cx/gpt-4o")).toBe(true);
    expect(await access.allows("gpt-4o")).toBe(true);
    expect(await access.allows("openai/gpt-4o-mini")).toBe(false);
  });
  it("does not let model aliases broaden a grant", async () => {
    await scope(async () => {
      await aliases.setModelAlias("friendly", "openai/gpt-4o");
      await policies.saveWorkspaceModelAccess(restricted(["friendly"]));
      await aliases.setModelAlias("friendly", "anthropic/claude-other");
    });
    expect(await (await snapshot()).allows("friendly")).toBe(false);
    expect(await (await snapshot()).allows("openai/gpt-4o")).toBe(true);
  });
  it("canonicalizes compatible provider prefixes to stable node IDs", async () => {
    const nodes = await import("@/lib/db/repos/nodesRepo.js");
    const node = await scope(() => nodes.createProviderNode({ name: "Compatible", prefix: "test-compatible", type: "openai-compatible" }));
    const policy = await scope(() => policies.saveWorkspaceModelAccess(restricted(["test-compatible/model-a"])));
    expect(policy.models).toEqual([`${node.id}/model-a`]);
    expect(await (await snapshot()).allows("test-compatible/model-a")).toBe(true);
    expect(await (await snapshot()).allows("test-compatible/model-b")).toBe(false);
  });
  it("intersects a member's private list with the workspace ceiling", async () => {
    await scope(async () => {
      await policies.saveWorkspaceModelAccess(restricted(["openai/a", "openai/b"]));
      await policies.saveMemberModelAccess(member.id, restricted(["openai/b", "openai/c"]));
    });
    const access = await snapshot();
    expect(access.summary.models).toEqual(["openai/b"]);
    expect(await access.allows("openai/a")).toBe(false);
    expect(await access.allows("openai/b")).toBe(true);
    expect(await access.allows("openai/c")).toBe(false);
  });
  it("restricts a member independently when the workspace permits all", async () => {
    await scope(() => policies.saveMemberModelAccess(member.id, restricted(["openai/b"])));
    expect((await snapshot()).summary.models).toEqual(["openai/b"]);
    expect(await (await snapshot()).allows("openai/a")).toBe(false);
  });
  it("treats an empty selection as deny-all, not unlimited", async () => {
    await scope(() => policies.saveWorkspaceModelAccess(restricted()));
    expect(await (await snapshot()).allows("openai/gpt-4o")).toBe(false);
    expect(await (await snapshot()).allows(combo.name)).toBe(false);
  });
  it("grants a combo without granting direct calls to its leaf models", async () => {
    await scope(() => policies.saveWorkspaceModelAccess(restricted([], [combo.id])));
    const access = await snapshot();
    expect(await access.allows(combo.name)).toBe(true);
    expect(await access.allows("openai/gpt-4o")).toBe(false);
  });
  it("keeps combo grants after renaming but not deletion/recreation", async () => {
    const fixture = await scope(() => combos.createCombo({ name: "rename-test", models: ["openai/a"] }));
    await scope(async () => {
      await policies.saveWorkspaceModelAccess(restricted([], [fixture.id]));
      await combos.updateCombo(fixture.id, { name: "renamed-test" });
    });
    expect(await (await snapshot()).allows("renamed-test")).toBe(true);
    await scope(async () => { await combos.deleteCombo(fixture.id); await combos.createCombo({ name: "renamed-test", models: ["openai/a"] }); });
    expect(await (await snapshot()).allows("renamed-test")).toBe(false);
  });
  it("rejects cross-workspace combo IDs and nonexistent members", async () => {
    const foreign = await scope(() => combos.createCombo({ name: "foreign", models: ["openai/a"] }), other.id);
    await expect(scope(() => policies.saveWorkspaceModelAccess(restricted([], [foreign.id])))).rejects.toThrow("workspace");
    await expect(scope(() => policies.saveMemberModelAccess("missing", restricted()))).rejects.toThrow("Member not found");
  });
  it.each([null, [], { mode: "bad" }, restricted([null]), restricted(["bad model"]), restricted([], [null])])("validates malformed input %j", async (value) => {
    await expect(scope(() => policies.saveWorkspaceModelAccess(value))).rejects.toThrow();
  });
  it("fails closed for corrupted persistent JSON and null", async () => {
    for (const value of ["{broken", "null", "[]", '{"mode":"unknown","models":["openai/a"],"comboIds":[]}', '{"mode":"restricted","models":["openai/a",null],"comboIds":[]}']) {
      adapter.run("UPDATE workspaceKv SET value = ? WHERE workspaceId = ? AND scope = 'modelAccess' AND key = 'workspace'", [value, workspace.id]);
      expect(await (await snapshot()).allows("openai/a")).toBe(false);
    }
  });
  it("cleans a removed member's policy so rejoining inherits current workspace settings", async () => {
    const users = await import("@/lib/db/repos/usersRepo.js");
    const rejoin = await users.createUser({ username: "rejoin-model-member" });
    await workspaces.addMember(workspace.id, rejoin.id, "member");
    await scope(() => policies.saveMemberModelAccess(rejoin.id, restricted(["openai/a"])));
    await workspaces.removeMember(workspace.id, rejoin.id);
    await workspaces.addMember(workspace.id, rejoin.id, "member");
    expect((await scope(() => policies.getMemberModelAccess(rejoin.id))).mode).toBe("inherit");
  });
  it("keeps access policies intact across routing export/import", async () => {
    await scope(async () => {
      await policies.saveWorkspaceModelAccess(restricted(["openai/a"], [combo.id]));
      await policies.saveMemberModelAccess(member.id, restricted([], [combo.id]));
      const payload = await db.exportDb({ includeGlobal: false });
      await db.importDb(payload, { includeGlobal: false });
    });
    const access = await snapshot();
    expect(access.workspace.models).toEqual(["openai/a"]);
    expect(access.member.comboIds).toEqual([combo.id]);
    expect(await access.allows(combo.name)).toBe(true);
  });
});

describe("LLM boundary enforcement", () => {
  beforeEach(async () => { await scope(() => policies.saveWorkspaceModelAccess(restricted(["openai/gpt-4o"]))); });
  it.each(["/v1/chat/completions", "/api/v1/responses", "/codex/responses", "/v1/embeddings", "/v1/audio/speech", "/v1/images/generations"])("denies %s before reaching providers and releases quota permits", async (url) => {
    const callback = vi.fn(() => Response.json({ ok: true }));
    for (let i = 0; i < 2; i++) {
      const response = await context.withLlmWorkspace(request(url, { model: "openai/blocked" }), callback);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("model_not_allowed");
    }
    expect(callback).not.toHaveBeenCalled();
  });
  it("allows permitted requests without consuming the original body", async () => {
    const callback = vi.fn(async () => Response.json({ model: (await incoming.json()).model }));
    const incoming = request("/v1/chat/completions", { model: "gpt-4o" });
    const response = await context.withLlmWorkspace(incoming, callback);
    expect(response.status).toBe(200);
    expect((await response.json()).model).toBe("gpt-4o");
  });
  it("reads the actual Gemini URL target instead of a body model", async () => {
    const callback = vi.fn(() => Response.json({ ok: true }));
    expect((await context.withLlmWorkspace(request("/v1beta/models/gemini-blocked:generateContent", { model: "openai/gpt-4o" }), callback)).status).toBe(403);
    await scope(() => policies.saveWorkspaceModelAccess(restricted(["gemini/gemini-allowed"])));
    const response = await context.withLlmWorkspace(request("/api/v1beta/models/gemini-allowed:streamGenerateContent", { model: "openai/blocked" }), callback);
    expect(response.status).toBe(200);
    await response.json();
  });
  it("checks the multipart STT model", async () => {
    const body = new FormData(); body.set("model", "openai/blocked"); body.set("file", new Blob(["test"]), "audio.wav");
    const response = await context.withLlmWorkspace(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key.key}` }, body }), vi.fn());
    expect(response.status).toBe(403);
  });
  it.each(["/v1/search", "/v1/web/fetch"])("honors provider precedence and provider-as-model semantics on %s", async (url) => {
    const service = url.endsWith("search") ? "search" : "fetch";
    await scope(() => policies.saveWorkspaceModelAccess(restricted([`tavily/${service}`])));
    const callback = vi.fn(() => Response.json({ ok: true }));
    const response = await context.withLlmWorkspace(request(url, { provider: "tavily", model: "blocked" }), callback);
    expect(response.status).toBe(200);
    await response.json();
    expect((await context.withLlmWorkspace(request(url, { provider: "blocked", model: "tavily" }), callback)).status).toBe(403);
  });
  it("prevents default video provider fallback bypasses", async () => {
    const callback = vi.fn(() => Response.json({ ok: true }));
    await scope(() => policies.saveWorkspaceModelAccess(restricted(["openai/foo"])));
    expect((await context.withLlmWorkspace(request("/v1/videos/generations", { model: "foo" }), callback)).status).toBe(403);
    const body = new FormData(); body.set("model", "openai/foo");
    expect((await context.withLlmWorkspace(new Request("http://localhost/v1/videos/generations", { method: "POST", headers: { authorization: `Bearer ${key.key}` }, body }), callback)).status).toBe(403);
    expect(callback).not.toHaveBeenCalled();
  });
  it.each(["/v1/search/", "/v1/%73earch", "/v1/web/%66etch/"])("normalizes static route names and trailing slashes on %s", async (url) => {
    const callback = vi.fn(() => Response.json({ ok: true }));
    expect((await context.withLlmWorkspace(request(url, { provider: "blocked", model: "openai/gpt-4o" }), callback)).status).toBe(403);
    expect(callback).not.toHaveBeenCalled();
  });
  it("denies missing targets and reports invalid JSON without leaking permits", async () => {
    expect((await context.withLlmWorkspace(request("/v1/chat/completions", {}), vi.fn())).status).toBe(403);
    const malformed = new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" }, body: "{" });
    expect((await context.withLlmWorkspace(malformed, vi.fn())).status).toBe(400);
  });
  it.each(["/v1/models", "/api/v1/models", "/v1/v1/models", "/v1/models/embedding"])("filters discovery on %s and preserves metadata", async (url) => {
    const incoming = new Request(`http://localhost${url}`, { headers: { authorization: `Bearer ${key.key}` } });
    const response = await context.withLlmWorkspace(incoming, () => Response.json({ object: "list", data: [{ id: "gpt-4o", kind: "llm" }, { id: "openai/blocked" }, { id: combo.name }] }, { headers: { etag: "old", "content-length": "9999" } }));
    expect((await response.json()).data).toEqual([{ id: "gpt-4o", kind: "llm" }]);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("applies policy changes on the next request for existing keys", async () => {
    const callback = () => Response.json({ ok: true });
    const incoming = () => request("/v1/chat/completions", { model: "openai/gpt-4o" });
    const response = await context.withLlmWorkspace(incoming(), callback);
    expect(response.status).toBe(200);
    await response.json();
    await scope(() => policies.saveWorkspaceModelAccess(restricted()));
    expect((await context.withLlmWorkspace(incoming(), callback)).status).toBe(403);
  });
  it("applies the workspace ceiling to Owner keys as well", async () => {
    const ownerKey = await context.runWithWorkspace({ workspaceId: workspace.id, userId: owner.id }, () => db.createApiKey("owner", "test", owner.id));
    const incoming = request("/v1/chat/completions", { model: "openai/blocked" }, { headers: { authorization: `Bearer ${ownerKey.key}`, "content-type": "application/json" } });
    expect((await context.withLlmWorkspace(incoming, vi.fn())).status).toBe(403);
  });
  it("isolates allowances across workspace keys", async () => {
    const otherKey = await context.runWithWorkspace({ workspaceId: other.id, userId: owner.id }, () => db.createApiKey("other", "test", owner.id));
    const incoming = request("/v1/chat/completions", { model: "openai/blocked" }, { headers: { authorization: `Bearer ${otherKey.key}`, "content-type": "application/json" } });
    const response = await context.withLlmWorkspace(incoming, () => Response.json({ ok: true }));
    expect(response.status).toBe(200);
    await response.json();
  });
});

describe("Owner-only model management API", () => {
  const apiRequest = (token, method = "GET", body = undefined) => new NextRequest(`http://localhost/api/workspaces/${workspace.id}/model-access`, { method, headers: { cookie: `auth_token=${token}`, "content-type": "application/json" }, ...(method !== "GET" && body ? { body: JSON.stringify(body) } : {}) });
  const params = (userId) => ({ params: Promise.resolve({ id: workspace.id, ...(userId ? { userId } : {}) }) });
  it.each(["GET", "PATCH"])("denies %s to Member and Admin even with stale Owner claims", async (method) => {
    for (const role of ["member", "admin"]) {
      await workspaces.updateMemberRole(workspace.id, member.id, role);
      for (const userId of [undefined, member.id]) {
        expect((await routes.handleModelAccess(apiRequest("member", method, restricted()), params(userId))).status).toBe(403);
      }
    }
  });
  it("permits Owner configuration and returns a credential-free local catalog", async () => {
    const response = await routes.handleModelAccess(apiRequest("owner"), params());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.catalog.models.length).toBeGreaterThan(0);
    expect(result.catalog.combos.find((item) => item.id === combo.id).name).toBe(combo.name);
    expect(JSON.stringify(result)).not.toContain("accessToken");
    expect((await routes.handleModelAccess(apiRequest("owner", "PATCH", restricted(["openai/a"])), params())).status).toBe(200);
    expect((await routes.handleModelAccess(apiRequest("owner", "PATCH", restricted(["openai/a"])), params(member.id))).status).toBe(200);
    expect((await snapshot()).summary.models).toEqual(["openai/a"]);
  });
  it("rejects unauthenticated, nonmember and invalid configuration requests", async () => {
    expect((await routes.handleModelAccess(apiRequest("missing"), params())).status).toBe(401);
    expect((await routes.handleModelAccess(apiRequest("owner"), params("missing"))).status).toBe(404);
    expect((await routes.handleModelAccess(apiRequest("owner", "PATCH", { mode: "oops" }), params())).status).toBe(400);
  });
});
