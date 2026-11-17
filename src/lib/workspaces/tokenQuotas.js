import { WORKSPACE_ROLES } from "./constants.js";

// usageHistory columns holding the quota a row was charged, in standard tokens
// (see standardTokens.js). Rows written before migration 007 have NULL and
// count their raw tokens.
export const QUOTA_INPUT_SQL = "COALESCE(quotaInputTokens, promptTokens)";
export const QUOTA_OUTPUT_SQL = "COALESCE(quotaOutputTokens, completionTokens)";

export function readSplitTokenLimits(body) {
  const { dailyInputTokenLimit, dailyOutputTokenLimit } = body;
  if (dailyInputTokenLimit === undefined && dailyOutputTokenLimit === undefined) return {};
  for (const value of [dailyInputTokenLimit, dailyOutputTokenLimit]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
      throw new Error("Input and output limits must both be integers from 0 to 1,000,000,000,000");
    }
  }
  return { dailyInputTokenLimit, dailyOutputTokenLimit };
}

export function getTokenQuotaBuckets(member, input = 0, output = 0) {
  const exempt = member.role === WORKSPACE_ROLES.OWNER;
  const limit = (value) => exempt ? 0 : Number(value || 0);
  if (member.dailyInputTokenLimit != null || member.dailyOutputTokenLimit != null) {
    return [
      { type: "input", limit: limit(member.dailyInputTokenLimit), used: input },
      { type: "output", limit: limit(member.dailyOutputTokenLimit), used: output },
    ];
  }
  return [{ type: "combined", limit: limit(member.dailyTokenLimit), used: input + output }];
}
