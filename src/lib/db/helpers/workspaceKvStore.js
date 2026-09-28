// Same shape as makeKv() (helpers/kvStore.js) but partitioned by workspaceId.
// workspaceId is explicit here, not read from ALS — callers (repos) resolve
// it via requireWorkspaceId() at their own boundary, matching the plan's
// "repo takes workspaceId from context or explicit param" rule.
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

export function makeWorkspaceKv(scope) {
  return {
    async get(workspaceId, key, fallback = null) {
      const db = await getAdapter();
      const row = db.get(`SELECT value FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`, [workspaceId, scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll(workspaceId) {
      const db = await getAdapter();
      const rows = db.all(`SELECT key, value FROM workspaceKv WHERE workspaceId = ? AND scope = ?`, [workspaceId, scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(workspaceId, key, value) {
      const db = await getAdapter();
      db.run(
        `INSERT INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, ?, ?, ?)
         ON CONFLICT(workspaceId, scope, key) DO UPDATE SET value = excluded.value`,
        [workspaceId, scope, key, stringifyJson(value)]
      );
    },
    async setMany(workspaceId, obj) {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          db.run(
            `INSERT INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, ?, ?, ?)
             ON CONFLICT(workspaceId, scope, key) DO UPDATE SET value = excluded.value`,
            [workspaceId, scope, k, stringifyJson(v)]
          );
        }
      });
    },
    async remove(workspaceId, key) {
      const db = await getAdapter();
      db.run(`DELETE FROM workspaceKv WHERE workspaceId = ? AND scope = ? AND key = ?`, [workspaceId, scope, key]);
    },
    async clear(workspaceId) {
      const db = await getAdapter();
      db.run(`DELETE FROM workspaceKv WHERE workspaceId = ? AND scope = ?`, [workspaceId, scope]);
    },
  };
}
