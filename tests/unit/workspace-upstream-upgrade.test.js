import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let dir, db, context, owner, member, first, second, adapter;
const scope = (workspace, fn) => context.runWithWorkspace({ workspaceId: workspace.id, userId: member.id }, fn);
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-upgrade-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  context = await import("@/lib/workspaces/requestContext.js");
  const users = await import("@/lib/db/repos/usersRepo.js");
  const workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  owner = await users.createUser({ username: "upgrade-owner" });
  member = await users.createUser({ username: "upgrade-member" });
  first = await workspaces.createWorkspace("First", owner.id);
  second = await workspaces.createWorkspace("Second", owner.id);
  await workspaces.addMember(first.id, member.id, "member", { dailyTokenLimit: 12345 });
  await workspaces.addMember(second.id, member.id, "member");
});
afterAll(async () => {
  await db?.closeDb();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("v0.5.111 and custom workspace integration", () => {
  it("keeps key access restrictions and ownership through a workspace backup round trip", async () => {
    await scope(first, async () => {
      const key = await db.createApiKey("restricted", "machine", member.id);
      await db.updateApiKey(key.id, { access: { restricted: true, allow: ["oa/gpt-4o"] } });
      const backup = await db.exportDb({ includeGlobal: false });
      expect(backup.apiKeys[0]).toMatchObject({ userId: member.id, access: { restricted: true, allow: ["oa/gpt-4o"] } });
      expect(backup.settings).toBeUndefined();
      await db.importDb(backup, { includeGlobal: false });
      expect(await db.getApiKeyById(key.id)).toMatchObject({ userId: member.id, access: { restricted: true, allow: ["oa/gpt-4o"] } });
      expect(await (await import("@/lib/db/repos/apiKeysRepo.js")).resolveApiKey(key.key)).toMatchObject({ workspaceId: first.id, userId: member.id });
    });
    expect(await scope(second, () => db.getApiKeys())).toEqual([]);
  });

  it("upserts custom STT caps and transport within one workspace", async () => {
    await scope(first, async () => {
      await db.addCustomModel({ providerAlias: "test", id: "speech", type: "stt", caps: { audioInput: true }, transport: "gemini-live" });
      await db.addCustomModel({ providerAlias: "test", id: "speech", type: "stt", name: "Updated speech" });
      expect(await db.getCustomModels()).toContainEqual(expect.objectContaining({ name: "Updated speech", transport: "gemini-live", caps: { audioInput: true } }));
    });
    expect(await scope(second, () => db.getCustomModels())).toEqual([]);
  });

  it("keeps provider deduplication, priority and overwrite protection workspace-local", async () => {
    const make = (key) => ({ provider: "openai", authType: "apikey", name: "Key 1", apiKey: key, allowOverwrite: false });
    const a = await scope(first, () => db.createProviderConnection(make("first")));
    const b = await scope(second, () => db.createProviderConnection(make("second")));
    expect(a.priority).toBe(1);
    expect(b.priority).toBe(1);
    await expect(scope(first, () => db.createProviderConnection(make("overwrite")))).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT" });
    expect(await scope(second, () => db.getProviderConnectionById(a.id))).toBeNull();
    expect((await scope(first, () => db.getProviderConnectionById(a.id))).apiKey).toBe("first");
  });

  it("upgrades an existing custom v5 database without losing membership or key ownership", async () => {
    const before = adapter.all("SELECT id, workspaceId, userId, key FROM apiKeys");
    adapter.exec("ALTER TABLE apiKeys DROP COLUMN accessRestricted; ALTER TABLE apiKeys DROP COLUMN accessAllow;");
    adapter.run("UPDATE _meta SET value = '5' WHERE key = 'backupSchemaVersion'");
    await db.closeDb();
    adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(adapter.all("SELECT id, workspaceId, userId, key FROM apiKeys")).toEqual(before);
    expect(fs.readdirSync(path.join(dir, "db", "backups")).some((name) => name.startsWith("schema-5-to-6"))).toBe(true);
    expect(adapter.get("SELECT dailyTokenLimit FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [first.id, member.id]).dailyTokenLimit).toBe(12345);
    expect((await scope(first, () => db.getApiKeys()))[0].access).toEqual({ restricted: false, allow: [] });
  });

  it("binds SAML sessions to persistent users and workspaces without elevating a local email match", async () => {
    const { resolveSamlUser } = await import("@/lib/auth/samlUser.js");
    const profile = { issuer: "https://idp.example.test", nameID: "external-subject" };
    const settings = { samlEntryPoint: "https://idp.example.test/login" };
    const firstLogin = await resolveSamlUser(profile, settings, { email: "upgrade-owner", name: "SSO User" });
    const nextLogin = await resolveSamlUser(profile, settings, { name: "Updated User" });
    expect(firstLogin.user.id).not.toBe(owner.id);
    expect(nextLogin.user.id).toBe(firstLogin.user.id);
    expect(nextLogin.user.displayName).toBe("Updated User");
    const { getMember } = await import("@/lib/db/repos/workspacesRepo.js");
    expect((await getMember(nextLogin.activeWorkspaceId, nextLogin.user.id)).role).toBe("admin");
    const { isPasswordSession } = await import("@/lib/auth/passwordPolicy.js");
    expect(isPasswordSession({ loginMethod: "saml", saml: true })).toBe(false);
  });

  it("filters upstream single-model lookups through the custom member allow-list", async () => {
    const { filterModelCatalog } = await import("@/lib/workspaces/modelAccess.js");
    const response = await filterModelCatalog(new Request("http://localhost/v1/models/oa/gpt-4o"), Response.json({ id: "oa/gpt-4o" }), { restricted: true, allows: async () => false });
    expect(response.status).toBe(404);
  });
});
