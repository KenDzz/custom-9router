// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { getWorkspaceContext, requireWorkspaceId } from "@/lib/workspaces/requestContext.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionsAcrossWorkspaces, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import one workspace's routing payload. Global settings/pricing stay
// optional so route authorization can expose them only to Default owners.
export async function exportDb({ includeGlobal = true } = {}) {
  const workspaceId = requireWorkspaceId();
  const db = await getAdapter();
  const out = {
    providerConnections: db.all(`SELECT * FROM providerConnections WHERE workspaceId = ?`, [workspaceId]).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes WHERE workspaceId = ?`, [workspaceId]).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools WHERE workspaceId = ?`, [workspaceId]).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys WHERE workspaceId = ?`, [workspaceId]).map((r) => ({ id: r.id, userId: r.userId, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: db.all(`SELECT * FROM combos WHERE workspaceId = ?`, [workspaceId]).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
  };

  for (const r of db.all(`SELECT scope, key, value FROM workspaceKv WHERE workspaceId = ?`, [workspaceId])) {
    if (r.scope === "modelAliases") out.modelAliases[r.key] = parseJson(r.value);
    else if (r.scope === "customModels") out.customModels.push(parseJson(r.value));
    else if (r.scope === "mitmAlias") out.mitmAlias[r.key] = parseJson(r.value);
  }

  if (includeGlobal) {
    const { exportSettings } = await import("./repos/settingsRepo.js");
    out.settings = await exportSettings();
    out.pricing = {};
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) {
      out.pricing[r.key] = parseJson(r.value);
    }
  }

  return out;
}

export async function importDb(payload, { includeGlobal = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const workspaceId = requireWorkspaceId();
  const importingUserId = getWorkspaceContext()?.userId || null;
  const db = await getAdapter();

  db.transaction(() => {
    db.run(`DELETE FROM providerConnections WHERE workspaceId = ?`, [workspaceId]);
    db.run(`DELETE FROM providerNodes WHERE workspaceId = ?`, [workspaceId]);
    db.run(`DELETE FROM proxyPools WHERE workspaceId = ?`, [workspaceId]);
    db.run(`DELETE FROM apiKeys WHERE workspaceId = ?`, [workspaceId]);
    db.run(`DELETE FROM combos WHERE workspaceId = ?`, [workspaceId]);
    db.run(`DELETE FROM workspaceKv WHERE workspaceId = ? AND scope IN ('modelAliases', 'customModels', 'mitmAlias')`, [workspaceId]);

    if (includeGlobal && payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, workspaceId, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, workspaceId, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, workspaceId, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      const keyOwnerId = k.userId && db.get("SELECT 1 FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [workspaceId, k.userId])
        ? k.userId
        : importingUserId || db.get("SELECT userId FROM workspaceMembers WHERE workspaceId = ? AND role = 'owner' ORDER BY createdAt ASC LIMIT 1", [workspaceId])?.userId || null;
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, workspaceId, userId, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, workspaceId, keyOwnerId, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, workspaceId, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [c.id, workspaceId, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, 'modelAliases', ?, ?)`, [workspaceId, a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, 'customModels', ?, ?)`, [workspaceId, k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, 'mitmAlias', ?, ?)`, [workspaceId, tool, stringifyJson(mappings || {})]);
    }
    if (includeGlobal) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing'`);
      for (const [provider, models] of Object.entries(payload.pricing || {})) {
        db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
      }
    }
  });

  return exportDb({ includeGlobal });
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}

// Explicit lifecycle seam for tests and controlled shutdowns.
export { closeAdapter as closeDb } from "./driver.js";
