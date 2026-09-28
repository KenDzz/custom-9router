import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeWorkspaceKv } from "../helpers/workspaceKvStore.js";
import { requireWorkspaceId } from "@/lib/workspaces/requestContext.js";

const SCOPE = "disabledModels";
const disabledKv = makeWorkspaceKv(SCOPE);

export async function getDisabledModels() {
  return disabledKv.getAll(requireWorkspaceId());
}

export async function getDisabledByProvider(providerAlias) {
  return disabledKv.get(requireWorkspaceId(), providerAlias, []);
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias, ids) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const workspaceId = requireWorkspaceId();
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(
      `SELECT value FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`,
      [workspaceId, SCOPE, providerAlias],
    );
    const current = row ? (parseJson(row.value, []) || []) : [];
    const merged = [...new Set([...current, ...ids])];
    db.run(
      `INSERT INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, ?, ?, ?)
       ON CONFLICT(workspaceId, scope, key) DO UPDATE SET value = excluded.value`,
      [workspaceId, SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
}

export async function enableModels(providerAlias, ids) {
  if (!providerAlias) return;
  const workspaceId = requireWorkspaceId();
  const db = await getAdapter();
  db.transaction(() => {
    if (!Array.isArray(ids) || ids.length === 0) {
      db.run(
        `DELETE FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`,
        [workspaceId, SCOPE, providerAlias],
      );
      return;
    }
    const row = db.get(
      `SELECT value FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`,
      [workspaceId, SCOPE, providerAlias],
    );
    const current = row ? (parseJson(row.value, []) || []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      db.run(
        `DELETE FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`,
        [workspaceId, SCOPE, providerAlias],
      );
    } else {
      db.run(
        `INSERT INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, ?, ?, ?)
         ON CONFLICT(workspaceId, scope, key) DO UPDATE SET value = excluded.value`,
        [workspaceId, SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
}
