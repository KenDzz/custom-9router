// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 4;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  users: {
    columns: {
      id: "TEXT PRIMARY KEY",
      username: "TEXT UNIQUE NOT NULL",
      email: "TEXT UNIQUE",
      displayName: "TEXT",
      passwordHash: "TEXT",
      oidcIssuer: "TEXT",
      oidcSubject: "TEXT",
      isActive: "INTEGER NOT NULL DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_identity ON users(oidcIssuer, oidcSubject) WHERE oidcIssuer IS NOT NULL AND oidcSubject IS NOT NULL",
      "CREATE INDEX IF NOT EXISTS idx_users_active ON users(isActive)",
    ],
  },
  workspaces: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      isDefault: "INTEGER NOT NULL DEFAULT 0",
      createdByUserId: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default ON workspaces(isDefault) WHERE isDefault = 1",
      "CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON workspaces(createdByUserId)",
    ],
  },
  workspaceMembers: {
    columns: {
      workspaceId: "TEXT NOT NULL",
      userId: "TEXT NOT NULL",
      role: "TEXT NOT NULL CHECK (role IN ('member', 'admin', 'owner'))",
      dailyTokenLimit: "INTEGER NOT NULL DEFAULT 0",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (workspaceId, userId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspaceMembers(userId)",
      "CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON workspaceMembers(workspaceId, role)",
    ],
  },
  workspaceInvites: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      email: "TEXT NOT NULL",
      role: "TEXT NOT NULL CHECK (role IN ('member', 'admin'))",
      dailyTokenLimit: "INTEGER",
      tokenHash: "TEXT UNIQUE NOT NULL",
      invitedByUserId: "TEXT NOT NULL",
      expiresAt: "TEXT NOT NULL",
      acceptedAt: "TEXT",
      revokedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspaceInvites(workspaceId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspaceInvites(workspaceId, email)",
    ],
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_workspace_provider ON providerConnections(workspaceId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_workspace_provider_active ON providerConnections(workspaceId, provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_workspace_priority ON providerConnections(workspaceId, provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pn_workspace_type ON providerNodes(workspaceId, type)",
    ],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_workspace_active ON proxyPools(workspaceId, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_workspace_status ON proxyPools(workspaceId, testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      userId: "TEXT",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_workspace_created ON apiKeys(workspaceId, createdAt)",
      "CREATE INDEX IF NOT EXISTS idx_ak_workspace_user ON apiKeys(workspaceId, userId, createdAt)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_combo_workspace_name ON combos(workspaceId, name)",
    ],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  workspaceKv: {
    columns: {
      workspaceId: "TEXT NOT NULL",
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (workspaceId, scope, key)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_workspace_kv_scope ON workspaceKv(workspaceId, scope)",
    ],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      workspaceId: "TEXT NOT NULL",
      userId: "TEXT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_workspace_ts ON usageHistory(workspaceId, timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_workspace_provider ON usageHistory(workspaceId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_workspace_model ON usageHistory(workspaceId, model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_workspace_conn ON usageHistory(workspaceId, connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_workspace_user_ts ON usageHistory(workspaceId, userId, timestamp DESC)",
    ],
  },
  usageDaily: {
    columns: {
      workspaceId: "TEXT NOT NULL",
      dateKey: "TEXT NOT NULL",
      data: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (workspaceId, dateKey)",
  },
  workspaceUsageMeta: {
    columns: {
      workspaceId: "TEXT PRIMARY KEY",
      totalRequestsLifetime: "INTEGER NOT NULL DEFAULT 0",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      workspaceId: "TEXT NOT NULL",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_workspace_ts ON requestDetails(workspaceId, timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_workspace_provider ON requestDetails(workspaceId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_workspace_model ON requestDetails(workspaceId, model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_workspace_conn ON requestDetails(workspaceId, connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
