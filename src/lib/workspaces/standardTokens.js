// Member quotas are counted in "standard tokens" (token chuẩn): the USD cost
// of a request converted back to tokens at a fixed reference price. A cache
// read on Sonnet counts a tenth of a fresh input token, an Opus output token
// counts more than a Sonnet one, and a free model counts nothing.
//
// The reference price is Sonnet 5.5 input ($2 / 1M tokens), so 1 standard
// token = $0.000002 and 1M standard tokens = $2. The cost itself comes from
// the same calculateCostFromTokens() that fills usageHistory.cost.
import { calculateCostFromTokens } from "open-sse/providers/pricing.js";

export const STANDARD_TOKEN_USD_PER_MILLION = 2;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function hasPrice(pricing) {
  return Boolean(pricing)
    && Number.isFinite(Number(pricing.input))
    && Number.isFinite(Number(pricing.output));
}

export function usdToStandardTokens(usd) {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) return 0;
  // The epsilon absorbs float noise so an exact price does not round up a token.
  return Math.max(0, Math.ceil((value * 1e6) / STANDARD_TOKEN_USD_PER_MILLION - 1e-9));
}

// Zeroing one side lets the unchanged cost formula price the other side alone.
const INPUT_SIDE = { completion_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
const OUTPUT_SIDE = {
  prompt_tokens: 0, input_tokens: 0, cached_tokens: 0,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
};

/**
 * Quota charge of one request, split into its input and output side.
 *  - priced model: cost of each side in standard tokens (cache reads, cache
 *    writes and reasoning at their own rates, exactly as the cost column);
 *  - model priced at zero: nothing;
 *  - model without a price: raw tokens at 1x, so an unknown model is never free.
 * @returns {{input: number, output: number, priced: boolean}}
 */
export function computeQuotaTokens(tokens, pricing) {
  const t = tokens || {};
  if (hasPrice(pricing)) {
    return {
      input: usdToStandardTokens(calculateCostFromTokens({ ...t, ...INPUT_SIDE }, pricing)),
      output: usdToStandardTokens(calculateCostFromTokens({ ...t, ...OUTPUT_SIDE }, pricing)),
      priced: true,
    };
  }
  return {
    // Same fields as usageHistory.promptTokens / completionTokens.
    input: Math.round(num(t.prompt_tokens || t.input_tokens)),
    output: Math.round(num(t.completion_tokens || t.output_tokens)),
    priced: false,
  };
}
