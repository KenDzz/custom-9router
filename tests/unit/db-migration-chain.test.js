// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
      "users", "workspaces", "workspaceMembers", "workspaceInvites", "workspaceKv", "workspaceUsageMeta",
    ]));

    // Fresh DB seeds a deterministic Default workspace + admin owner.
    const workspace = db.get(`SELECT * FROM workspaces WHERE isDefault = 1`);
    expect(workspace?.name).toBe("Default");
    const membership = db.get(`SELECT role FROM workspaceMembers WHERE workspaceId = ?`, [workspace.id]);
    expect(membership?.role).toBe("owner");
    expect(db.all("PRAGMA table_info(workspaceInvites)").map((column) => column.name)).toContain("dailyTokenLimit");
  });

  it("adds invitation limits to an existing v3 database without dropping pending invites", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const workspace = db.get("SELECT id, createdByUserId FROM workspaces WHERE isDefault = 1");
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO workspaceInvites(id, workspaceId, email, role, tokenHash, invitedByUserId, expiresAt, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["old-invite", workspace.id, "legacy@example.com", "member", "old-hash", workspace.createdByUserId, now, now, now],
    );
    db.exec("ALTER TABLE workspaceInvites DROP COLUMN dailyTokenLimit");
    db.run("UPDATE _meta SET value = '3' WHERE key = 'schemaVersion'");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getUpgradedAdapter } = await import("@/lib/db/driver.js");
    const upgraded = await getUpgradedAdapter();
    expect(upgraded.get("SELECT email, dailyTokenLimit FROM workspaceInvites WHERE id = 'old-invite'"))
      .toMatchObject({ email: "legacy@example.com", dailyTokenLimit: null });
    expect(upgraded.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("4");
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: { foo: "legacy-value" },
      apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "legacy-value" });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("abc");
    const workspace = db.get(`SELECT id FROM workspaces WHERE isDefault = 1`);
    expect(keys[0].workspaceId).toBe(workspace.id);

    const aliases = db.all(`SELECT * FROM workspaceKv WHERE workspaceId = ? AND scope='modelAliases'`, [workspace.id]);
    expect(aliases).toHaveLength(1);
  });

  it("existing v1 DB with data → migration 002 rebuilds routing tables into Default workspace", async () => {
    // Build a real v1-shaped DB by hand (no workspaceId columns), independent
    // of current schema.js, to exercise the shadow-table rebuild path.
    const Database = (await import("better-sqlite3")).default;
    const dbFile = path.join(tempDir, "db", "data.sqlite");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const raw = new Database(dbFile);
    raw.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE providerConnections (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT NOT NULL,
        name TEXT, email TEXT, priority INTEGER, isActive INTEGER DEFAULT 1,
        data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE providerNodes (
        id TEXT PRIMARY KEY, type TEXT, name TEXT, data TEXT NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE proxyPools (
        id TEXT PRIMARY KEY, isActive INTEGER DEFAULT 1, testStatus TEXT,
        data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE combos (
        id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, kind TEXT,
        models TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT,
        machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL
      );
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT,
        model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT,
        promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT
      );
      CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE requestDetails (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT, model TEXT,
        connectionId TEXT, status TEXT, data TEXT NOT NULL
      );
      CREATE TABLE kv (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key));
    `);
    raw.prepare(`INSERT INTO _meta(key, value) VALUES('schemaVersion', '1')`).run();
    raw.prepare(`INSERT INTO settings(id, data) VALUES(1, ?)`).run(JSON.stringify({ password: "old-hash", foo: "bar" }));
    raw.prepare(`INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`)
      .run("pc1", "openai", "apikey", "{}", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
    raw.prepare(`INSERT INTO combos(id, name, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`)
      .run("cb1", "my-combo", "[]", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
    raw.prepare(`INSERT INTO apiKeys(id, key, createdAt) VALUES(?, ?, ?)`).run("ak1", "v1key", "2024-01-01T00:00:00.000Z");
    raw.prepare(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`).run("2024-01-01", JSON.stringify({ requests: 5 }));
    raw.prepare(`INSERT INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`).run("gpt-4", JSON.stringify("gpt-4-turbo"));
    raw.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const workspace = db.get(`SELECT * FROM workspaces WHERE isDefault = 1`);
    expect(workspace?.name).toBe("Default");

    // Every pre-existing row landed in Default, none dropped.
    expect(db.get(`SELECT workspaceId FROM providerConnections WHERE id='pc1'`).workspaceId).toBe(workspace.id);
    expect(db.get(`SELECT workspaceId FROM combos WHERE id='cb1'`).workspaceId).toBe(workspace.id);
    expect(db.get(`SELECT workspaceId FROM apiKeys WHERE id='ak1'`).workspaceId).toBe(workspace.id);
    expect(db.get(`SELECT workspaceId FROM usageDaily WHERE dateKey='2024-01-01'`).workspaceId).toBe(workspace.id);
    expect(db.all(`SELECT id FROM providerConnections`)).toHaveLength(1);
    expect(db.all(`SELECT id FROM combos`)).toHaveLength(1);

    // Legacy password hash moved onto the migrated admin user, stripped from settings.
    const admin = db.get(`SELECT passwordHash FROM users WHERE id = ?`, [workspace.createdByUserId]);
    expect(admin.passwordHash).toBe("old-hash");
    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });

    // modelAliases moved from global kv into workspaceKv.
    expect(db.all(`SELECT * FROM kv WHERE scope='modelAliases'`)).toHaveLength(0);
    const alias = db.get(`SELECT value FROM workspaceKv WHERE workspaceId=? AND scope='modelAliases' AND key='gpt-4'`, [workspace.id]);
    expect(JSON.parse(alias.value)).toBe("gpt-4-turbo");

    // combos.name uniqueness is now per-workspace, not global.
    expect(() => db.run(
      `INSERT INTO combos(id, workspaceId, name, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["cb2", "other-ws", "my-combo", "[]", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
    )).not.toThrow();
    expect(() => db.run(
      `INSERT INTO combos(id, workspaceId, name, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["cb3", workspace.id, "my-combo", "[]", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
    )).toThrow();
  });

  it("re-running migration 002 on an already-migrated DB is a no-op (idempotent)", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { default: m002 } = await import("@/lib/db/migrations/002-workspaces-rbac.js");

    const before = {
      pc: db.all(`SELECT * FROM providerConnections`),
      users: db.all(`SELECT * FROM users`),
      workspaces: db.all(`SELECT * FROM workspaces`),
    };
    expect(() => db.transaction(() => m002.up(db))).not.toThrow();
    expect(db.all(`SELECT * FROM providerConnections`)).toEqual(before.pc);
    expect(db.all(`SELECT * FROM users`)).toEqual(before.users);
    expect(db.all(`SELECT * FROM workspaces`)).toEqual(before.workspaces);
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_workspace_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_workspace_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_workspace_type");
  });

  it("upgrades a real v2-shaped database and preserves key/history attribution", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const workspace = db.get("SELECT id, createdByUserId FROM workspaces WHERE isDefault = 1");
    db.run("INSERT INTO apiKeys(id, workspaceId, key, name, createdAt) VALUES(?, ?, ?, ?, ?)",
      ["legacy-key", workspace.id, "legacy-raw-key", "Old key", "2024-01-01T00:00:00.000Z"]);
    db.run("INSERT INTO usageHistory(workspaceId, timestamp, apiKey, promptTokens, completionTokens) VALUES(?, ?, ?, ?, ?)",
      [workspace.id, "2024-01-01T00:00:00.000Z", "legacy-raw-key", 12, 5]);
    db.exec(`
      DROP INDEX idx_ak_workspace_user;
      DROP INDEX idx_uh_workspace_user_ts;
      ALTER TABLE apiKeys DROP COLUMN userId;
      ALTER TABLE usageHistory DROP COLUMN userId;
      ALTER TABLE workspaceMembers DROP COLUMN dailyTokenLimit;
      UPDATE _meta SET value = '2' WHERE key = 'schemaVersion';
    `);
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: restart } = await import("@/lib/db/driver.js");
    const upgraded = await restart();
    expect(upgraded.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("4");
    expect(upgraded.get("SELECT userId, name FROM apiKeys WHERE id = 'legacy-key'")).toEqual({
      userId: workspace.createdByUserId, name: "Old key",
    });
    expect(upgraded.get("SELECT userId, promptTokens, completionTokens FROM usageHistory WHERE apiKey = 'legacy-raw-key'"))
      .toEqual({ userId: workspace.createdByUserId, promptTokens: 12, completionTokens: 5 });
    expect(upgraded.get("SELECT dailyTokenLimit FROM workspaceMembers WHERE workspaceId = ?", [workspace.id]).dailyTokenLimit).toBe(0);
    const { default: migration } = await import("@/lib/db/migrations/003-member-token-limits.js");
    expect(() => upgraded.transaction(() => migration.up(upgraded))).not.toThrow();
    expect(upgraded.all("SELECT id FROM apiKeys")).toHaveLength(1);
  });
});
