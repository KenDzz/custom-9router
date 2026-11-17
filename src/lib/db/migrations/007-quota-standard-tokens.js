// Member quotas switch from raw tokens to standard tokens (cost-based, see
// src/lib/workspaces/standardTokens.js). Each usage row stores the quota it
// was charged so a later price change never rewrites history.
//
// Rows from the last 8 days are backfilled so today's quota (and any gift
// being consumed) is measured on the new scale right after the upgrade.
// Older rows keep NULL and readers fall back to the raw columns.
import { getPricingForModel as resolveConstPricing } from "open-sse/providers/pricing.js";
import { computeQuotaTokens } from "../../workspaces/standardTokens.js";
import { parseJson } from "../helpers/jsonCol.js";

const BACKFILL_DAYS = 8;

function loadUserPricing(db) {
  const pricing = {};
  try {
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) {
      pricing[row.key] = parseJson(row.value, {}) || {};
    }
  } catch {}
  return pricing;
}

export default {
  version: 7,
  name: "quota-standard-tokens",
  up(db) {
    const columns = db.all(`PRAGMA table_info(usageHistory)`);
    for (const field of ["quotaInputTokens", "quotaOutputTokens"]) {
      if (!columns.some(({ name }) => name === field)) db.exec(`ALTER TABLE usageHistory ADD COLUMN ${field} INTEGER`);
    }

    const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.all(
      `SELECT id, provider, model, promptTokens, completionTokens, tokens FROM usageHistory
       WHERE userId IS NOT NULL AND quotaInputTokens IS NULL AND timestamp >= ?`,
      [since],
    );
    if (!rows.length) return;

    const userPricing = loadUserPricing(db);
    const cache = new Map();
    const pricingFor = (provider, model) => {
      const key = `${provider || ""}|${model || ""}`;
      if (!cache.has(key)) {
        let pricing = null;
        if (model) {
          pricing = (provider && userPricing[provider]?.[model]) || null;
          if (!pricing) {
            try { pricing = resolveConstPricing(provider, model); } catch { pricing = null; }
          }
        }
        cache.set(key, pricing);
      }
      return cache.get(key);
    };

    for (const row of rows) {
      const stored = parseJson(row.tokens, null);
      const tokens = stored && typeof stored === "object"
        ? stored
        : { prompt_tokens: row.promptTokens || 0, completion_tokens: row.completionTokens || 0 };
      const quota = computeQuotaTokens(tokens, pricingFor(row.provider, row.model));
      db.run(
        `UPDATE usageHistory SET quotaInputTokens = ?, quotaOutputTokens = ? WHERE id = ?`,
        [quota.input, quota.output, row.id],
      );
    }
  },
};
