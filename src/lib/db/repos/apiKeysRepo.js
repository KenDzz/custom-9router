import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { requireWorkspaceId } from "@/lib/workspaces/requestContext.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId || null,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys({ userId } = {}) {
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  const rows = userId
    ? db.all(`SELECT * FROM apiKeys WHERE workspaceId = ? AND userId = ? ORDER BY createdAt ASC`, [workspaceId, userId])
    : db.all(`SELECT * FROM apiKeys WHERE workspaceId = ? ORDER BY createdAt ASC`, [workspaceId]);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id, { userId } = {}) {
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  const row = userId
    ? db.get(`SELECT * FROM apiKeys WHERE id = ? AND workspaceId = ? AND userId = ?`, [id, workspaceId, userId])
    : db.get(`SELECT * FROM apiKeys WHERE id = ? AND workspaceId = ?`, [id, workspaceId]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, userId = null) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    userId,
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, workspaceId, userId, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, workspaceId, apiKey.userId, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow]
  );
  return apiKey;
}

export async function updateApiKey(id, data, { userId } = {}) {
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  let result = null;
  db.transaction(() => {
    const row = userId
      ? db.get(`SELECT * FROM apiKeys WHERE id = ? AND workspaceId = ? AND userId = ?`, [id, workspaceId, userId])
      : db.get(`SELECT * FROM apiKeys WHERE id = ? AND workspaceId = ?`, [id, workspaceId]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ? WHERE id = ? AND workspaceId = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, id, workspaceId]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id, { userId } = {}) {
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  const res = userId
    ? db.run(`DELETE FROM apiKeys WHERE id = ? AND workspaceId = ? AND userId = ?`, [id, workspaceId, userId])
    : db.run(`DELETE FROM apiKeys WHERE id = ? AND workspaceId = ?`, [id, workspaceId]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

// Resolves a raw key to its workspace binding for withLlmWorkspace(). Keys are
// globally unique and never move workspace — see docs/CUSTOM_HOOKS.md.
export async function resolveApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT id, workspaceId, userId, isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true)) return null;
  return { apiKeyId: row.id, workspaceId: row.workspaceId, userId: row.userId || null };
}
