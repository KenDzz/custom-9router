import bcrypt from "bcryptjs";
import { TABLES, buildCreateTableSql } from "../schema.js";
import {
  DEFAULT_WORKSPACE_ID,
  MIGRATED_ADMIN_USER_ID,
  ROUTING_TABLES,
  WORKSPACE_ROLES,
} from "../../workspaces/constants.js";

const ROUTING_KV_SCOPES = ["modelAliases", "customModels", "disabledModels", "mitmAlias"];

const WORKSPACE_TABLES = [
  "users",
  "workspaces",
  "workspaceMembers",
  "workspaceInvites",
  "workspaceKv",
  "workspaceUsageMeta",
];

function createTable(db, tableName) {
  const def = TABLES[tableName];
  db.exec(buildCreateTableSql(tableName, def));
  for (const indexSql of def.indexes || []) db.exec(indexSql);
}

function tableInfo(db, tableName) {
  return db.all(`PRAGMA table_info(${tableName})`);
}

function hasUniqueIndex(db, tableName, columns) {
  return db.all(`PRAGMA index_list(${tableName})`).some((index) => {
    if (!index.unique) return false;
    const names = db.all(`PRAGMA index_info(${index.name})`).map((column) => column.name);
    return names.length === columns.length && names.every((name, i) => name === columns[i]);
  });
}

function needsRebuild(db, tableName) {
  const columns = tableInfo(db, tableName);
  const workspaceId = columns.find((column) => column.name === "workspaceId");
  if (!workspaceId || workspaceId.notnull !== 1) return true;

  if (tableName === "combos") {
    return !hasUniqueIndex(db, tableName, ["workspaceId", "name"])
      || hasUniqueIndex(db, tableName, ["name"]);
  }

  if (tableName === "usageDaily") {
    const primaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    return primaryKey.join(",") !== "workspaceId,dateKey";
  }

  return false;
}

function rebuildForWorkspace(db, tableName) {
  if (!needsRebuild(db, tableName)) return;

  const oldTable = `__workspace_v1_${tableName}`;
  db.exec(`ALTER TABLE ${tableName} RENAME TO ${oldTable}`);
  db.exec(buildCreateTableSql(tableName, TABLES[tableName]));

  const oldColumns = new Set(tableInfo(db, oldTable).map((column) => column.name));
  const newColumns = Object.keys(TABLES[tableName].columns);
  const selectColumns = newColumns.map((column) => {
    if (column === "workspaceId") return "?";
    if (!oldColumns.has(column)) {
      const definition = TABLES[tableName].columns[column] || "";
      const defaultValue = definition.match(/DEFAULT\s+([^\s,]+)/i)?.[1];
      if (defaultValue !== undefined) return defaultValue;
      if (!/NOT NULL/i.test(definition)) return "NULL";
      throw new Error(`[DB][migrate] cannot rebuild ${tableName}: missing required source column ${column}`);
    }
    return column;
  });

  const before = db.get(`SELECT COUNT(*) AS c FROM ${oldTable}`)?.c ?? 0;
  db.run(
    `INSERT INTO ${tableName}(${newColumns.join(", ")}) SELECT ${selectColumns.join(", ")} FROM ${oldTable}`,
    [DEFAULT_WORKSPACE_ID]
  );
  const after = db.get(`SELECT COUNT(*) AS c FROM ${tableName}`)?.c ?? 0;
  if (after !== before) {
    throw new Error(`[DB][migrate] ${tableName} row-count mismatch: expected ${before}, got ${after}`);
  }

  db.exec(`DROP TABLE ${oldTable}`);
  for (const indexSql of TABLES[tableName].indexes || []) db.exec(indexSql);
}

function readSettings(db) {
  const row = db.get("SELECT data FROM settings WHERE id = 1");
  if (!row?.data) return { row: null, data: {} };
  try {
    const data = JSON.parse(row.data);
    return { row, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { row, data: {} };
  }
}

function seedDefaultIdentity(db) {
  const now = new Date().toISOString();
  const { row, data: settings } = readSettings(db);
  const passwordHash = typeof settings.password === "string" && settings.password
    ? settings.password
    : bcrypt.hashSync(process.env.INITIAL_PASSWORD || "123456", 10);

  db.run(
    `INSERT OR IGNORE INTO users(
      id, username, email, displayName, passwordHash,
      oidcIssuer, oidcSubject, isActive, createdAt, updatedAt
    ) VALUES(?, 'admin', NULL, 'Administrator', ?, NULL, NULL, 1, ?, ?)`,
    [MIGRATED_ADMIN_USER_ID, passwordHash, now, now]
  );
  db.run(
    `INSERT OR IGNORE INTO workspaces(
      id, name, isDefault, createdByUserId, createdAt, updatedAt
    ) VALUES(?, 'Default', 1, ?, ?, ?)`,
    [DEFAULT_WORKSPACE_ID, MIGRATED_ADMIN_USER_ID, now, now]
  );
  db.run(
    `INSERT OR IGNORE INTO workspaceMembers(
      workspaceId, userId, role, createdAt, updatedAt
    ) VALUES(?, ?, ?, ?, ?)`,
    [DEFAULT_WORKSPACE_ID, MIGRATED_ADMIN_USER_ID, WORKSPACE_ROLES.OWNER, now, now]
  );

  if (row && Object.hasOwn(settings, "password")) {
    delete settings.password;
    db.run("UPDATE settings SET data = ? WHERE id = 1", [JSON.stringify(settings)]);
  }
}

function migrateWorkspaceKv(db) {
  const placeholders = ROUTING_KV_SCOPES.map(() => "?").join(", ");
  db.run(
    `INSERT OR REPLACE INTO workspaceKv(workspaceId, scope, key, value)
     SELECT ?, scope, key, value FROM kv WHERE scope IN (${placeholders})`,
    [DEFAULT_WORKSPACE_ID, ...ROUTING_KV_SCOPES]
  );
  db.run(`DELETE FROM kv WHERE scope IN (${placeholders})`, ROUTING_KV_SCOPES);
}

function migrateUsageMeta(db) {
  const row = db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'");
  const total = Number.parseInt(row?.value || "0", 10);
  db.run(
    `INSERT INTO workspaceUsageMeta(workspaceId, totalRequestsLifetime)
     VALUES(?, ?)
     ON CONFLICT(workspaceId) DO UPDATE SET totalRequestsLifetime = excluded.totalRequestsLifetime`,
    [DEFAULT_WORKSPACE_ID, Number.isFinite(total) ? total : 0]
  );
  db.run("DELETE FROM _meta WHERE key = 'totalRequestsLifetime'");
}

const migration = {
  version: 2,
  name: "workspaces-rbac",
  up(db) {
    for (const tableName of WORKSPACE_TABLES) createTable(db, tableName);
    seedDefaultIdentity(db);
    for (const tableName of ROUTING_TABLES) rebuildForWorkspace(db, tableName);
    migrateWorkspaceKv(db);
    migrateUsageMeta(db);
  },
};

export default migration;
