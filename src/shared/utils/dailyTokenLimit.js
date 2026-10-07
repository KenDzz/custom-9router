export const MAX_DAILY_TOKEN_LIMIT = 1_000_000_000_000;

export function normalizeDailyTokenLimitInput(value) {
  const text = String(value ?? "");
  if (!/^[\d,]*$/.test(text)) return null;
  return text.replaceAll(",", "").replace(/^0+(?=\d)/, "");
}

export function formatDailyTokenLimitInput(value) {
  const digits = String(value ?? "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function parseDailyTokenLimit(value) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) return null;
  const limit = Number(text);
  return Number.isSafeInteger(limit) && limit <= MAX_DAILY_TOKEN_LIMIT ? limit : null;
}
