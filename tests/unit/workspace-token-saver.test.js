import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_SAVER_FEATURES, normalizeTokenSaverPolicy, resolveTokenSaverPolicy } from "@/lib/workspaces/tokenSaverPolicy.js";

const auth = vi.hoisted(() => ({ sessions: new Map() }));
const chat = vi.hoisted(() => ({ core: vi.fn(), combo: false }));
vi.mock("@/lib/auth/dashboardSession.js", () => ({ getDashboardAuthSession: vi.fn(async (token) => auth.sessions.get(token)) }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: chat.core }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({ connectionId: "test", apiKey: "test" }),
  markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(), extractApiKey: () => "test", isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: async (_provider, credentials) => credentials }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "openai", model: "gpt-4o" }),
  getComboModels: async (model) => chat.combo && model === "test-combo" ? ["openai/gpt-4o"] : null,
}));
const originalDataDir = process.env.DATA_DIR;
let dir, db, context, policies, workspaces, owner, member, workspace, other, routes, NextRequest, key;
const scope = (fn, workspaceId = workspace.id, userId = member.id) => context.runWithWorkspace({ workspaceId, userId }, fn);
const system = Object.fromEntries(TOKEN_SAVER_FEATURES.map(({ key }) => [key, false]));
const apiRequest = (token, method = "GET", body) => new NextRequest(`http://localhost/api/workspaces/${workspace.id}/token-saver`, {
  method, headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const params = (userId, id = workspace.id) => ({ params: Promise.resolve({ id, ...(userId ? { userId } : {}) }) });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-token-saver-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  context = await import("@/lib/workspaces/requestContext.js");
  policies = await import("@/lib/db/repos/tokenSaverRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  const users = await import("@/lib/db/repos/usersRepo.js");
  await db.initDb();
  owner = await users.createUser({ username: "saver-owner" });
  member = await users.createUser({ username: "saver-member" });
  workspace = await workspaces.createWorkspace("Saver", owner.id);
  other = await workspaces.createWorkspace("Other", owner.id);
  await workspaces.addMember(workspace.id, member.id, "member");
  await workspaces.addMember(other.id, member.id, "member");
  key = await scope(() => db.createApiKey("saver key", "test", member.id));
  routes = await import("@/lib/workspaces/tokenSaverRoutes.js");
  ({ NextRequest } = await import("next/server"));
  auth.sessions.set("owner", { userId: owner.id, activeWorkspaceId: workspace.id });
  auth.sessions.set("member", { userId: member.id, activeWorkspaceId: workspace.id, role: "owner" });
});
beforeEach(async () => {
  await workspaces.updateMemberRole(workspace.id, member.id, "member");
  await scope(async () => {
    await policies.saveTokenSaverPolicy({});
    await policies.saveTokenSaverPolicy({}, member.id);
  });
});
afterAll(async () => {
  await db?.closeDb();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
});

describe("Token Saver inheritance", () => {
  it.each(["openai/gpt-4o", "test-combo"])("passes effective flags into chatCore for %s", async (model) => {
    chat.combo = true;
    chat.core.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    await scope(async () => {
      await policies.saveTokenSaverPolicy({ rtkEnabled: true, cavemanEnabled: true });
      await policies.saveTokenSaverPolicy({ rtkEnabled: false, ponytailEnabled: true }, member.id);
      const result = await handleChat(new Request("http://localhost/v1/chat/completions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "hello" }] }),
      }));
      expect(result.status).toBe(200);
    });
    expect(chat.core).toHaveBeenLastCalledWith(expect.objectContaining({ rtkEnabled: false, cavemanEnabled: true, ponytailEnabled: true }));
    chat.combo = false;
  });
  it.each(TOKEN_SAVER_FEATURES)("resolves explicit true and false for $label at each level", ({ key }) => {
    for (const base of [true, false]) {
      expect(resolveTokenSaverPolicy({ [key]: base }).effective[key]).toBe(base);
      expect(resolveTokenSaverPolicy({ [key]: base }, { [key]: !base }).effective[key]).toBe(!base);
      const result = resolveTokenSaverPolicy({ [key]: base }, { [key]: !base }, { [key]: base });
      expect(result.effective[key]).toBe(base);
      expect(result.sources[key]).toBe("member");
      expect(resolveTokenSaverPolicy({ [key]: base }, { [key]: !base }, { [key]: null }).sources[key]).toBe("workspace");
    }
  });
  it("keeps existing workspaces on system defaults and preserves non-switch settings", async () => {
    const settings = { ...system, rtkEnabled: true, headroomUrl: "http://internal", cavemanLevel: "full" };
    expect(await scope(() => policies.getEffectiveTokenSaverSettings(settings))).toEqual(settings);
    expect(await policies.getEffectiveTokenSaverSettings(settings)).toBe(settings);
  });
  it("persists member overrides, allows resetting inheritance and isolates workspaces", async () => {
    await scope(async () => {
      await policies.saveTokenSaverPolicy({ rtkEnabled: true, pxpipeEnabled: true });
      await policies.saveTokenSaverPolicy({ rtkEnabled: false }, member.id);
      expect(await policies.getEffectiveTokenSaverSettings(system)).toMatchObject({ rtkEnabled: false, pxpipeEnabled: true });
      await policies.saveTokenSaverPolicy({}, member.id);
      expect(await policies.getEffectiveTokenSaverSettings(system)).toMatchObject({ rtkEnabled: true, pxpipeEnabled: true });
    });
    expect(await scope(() => policies.getEffectiveTokenSaverSettings(system), other.id)).toEqual(system);
    expect((await scope(() => policies.getEffectiveTokenSaverSettings(system), workspace.id, owner.id)).rtkEnabled).toBe(true);
  });
  it("applies changed overrides on existing API keys and ignores spoofed identity headers", async () => {
    const request = () => new Request("http://localhost/v1/chat/completions", {
      method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json", "x-workspace-id": other.id, "x-user-id": owner.id },
      body: JSON.stringify({ model: "openai/gpt-4o" }),
    });
    const call = () => context.withLlmWorkspace(request(), async () => Response.json(await policies.getEffectiveTokenSaverSettings(system)));
    await scope(() => policies.saveTokenSaverPolicy({ rtkEnabled: true }));
    expect(await (await call()).json()).toMatchObject({ rtkEnabled: true });
    await scope(() => policies.saveTokenSaverPolicy({ rtkEnabled: false }, member.id));
    expect(await (await call()).json()).toMatchObject({ rtkEnabled: false });
  });
  it.each([null, [], { rtkEnabled: "false" }, { headroomUrl: "http://other" }, { pxpipeEnabled: 0 }])("rejects invalid policies: %j", (value) => {
    expect(() => normalizeTokenSaverPolicy(value)).toThrow();
  });
  it("removes member overrides when membership is removed", async () => {
    await scope(() => policies.saveTokenSaverPolicy({ cavemanEnabled: true }, member.id));
    await workspaces.removeMember(workspace.id, member.id);
    await workspaces.addMember(workspace.id, member.id, "member");
    expect((await scope(() => policies.getEffectiveTokenSaverSettings(system))).cavemanEnabled).toBe(false);
  });
});

describe("Owner-only Token Saver API", () => {
  it.each(["GET", "PATCH"])("denies %s to Member and Admin despite stale claims", async (method) => {
    for (const role of ["member", "admin"]) {
      await workspaces.updateMemberRole(workspace.id, member.id, role);
      for (const userId of [undefined, member.id]) {
        expect((await routes.handleTokenSaver(apiRequest("member", method, method === "PATCH" ? {} : undefined), params(userId))).status).toBe(403);
      }
    }
  });
  it("permits Owner edits, reports effective sources and exposes no secrets", async () => {
    expect((await routes.handleTokenSaver(apiRequest("owner", "PATCH", { rtkEnabled: true }), params())).status).toBe(200);
    const response = await routes.handleTokenSaver(apiRequest("owner", "PATCH", { rtkEnabled: false }), params(member.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    expect(data).toMatchObject({ policy: { rtkEnabled: false }, workspacePolicy: { rtkEnabled: true }, effective: { rtkEnabled: false }, sources: { rtkEnabled: "member" } });
    expect(Object.keys(data)).toEqual(["policy", "workspacePolicy", "effective", "sources"]);
    expect((await routes.handleTokenSaver(apiRequest("owner"), params())).status).toBe(200);
  });
  it("rejects unauthenticated, missing member, foreign workspace and malformed requests", async () => {
    expect((await routes.handleTokenSaver(apiRequest("missing"), params())).status).toBe(401);
    expect((await routes.handleTokenSaver(apiRequest("owner"), params("missing"))).status).toBe(404);
    expect((await routes.handleTokenSaver(apiRequest("member"), params(undefined, "foreign"))).status).toBe(403);
    expect((await routes.handleTokenSaver(apiRequest("owner", "PATCH", { rtkEnabled: "off" }), params())).status).toBe(400);
  });
});
