export const HISTORY_KEY = "providerQuotaStatusHistory.v1";

export function quotaDays(now = new Date()) {
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i, 12);
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return { key, date };
  });
}

export function remainingQuota(quota) {
  if (quota.unlimited || quota.message) return null;
  const percentage = [quota.percentage, quota.remainingPercentage, quota.remaining].find((value) => Number.isFinite(value));
  if (percentage == null && !(Number(quota.total) > 0)) return null;
  const value = Number.isFinite(quota.percentage)
    ? quota.percentageIsUsed ? 100 - quota.percentage : quota.percentage
    : percentage ?? 100 * (1 - Number(quota.used || 0) / Number(quota.total));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function quotaSeverity(quotas = []) {
  return quotas.reduce((worst, quota) => {
    const value = remainingQuota(quota);
    const severity = quota.unlimited ? 1 : value == null ? 0 : value === 0 ? 3 : value <= 20 ? 2 : 1;
    return Math.max(worst, severity);
  }, 0);
}

export function recordQuotaSnapshot(history, id, severity, now = new Date()) {
  if (!severity) return history;
  const days = quotaDays(now);
  const today = days.at(-1).key;
  if ((history[today]?.[id] ?? 0) >= severity) return history;
  const next = Object.fromEntries(days.filter(({ key }) => history[key]).map(({ key }) => [key, history[key]]));
  next[today] = { ...next[today], [id]: severity };
  return next;
}

export function nextQuotaReset(quotas, now = Date.now()) {
  const timestamps = quotas
    .filter((quota) => quota.resetAt && !quota.neverExpires && quota.recurring !== false)
    .map((quota) => new Date(quota.resetAt).getTime())
    .filter((timestamp) => timestamp > now);
  return timestamps.length ? Math.min(...timestamps) : null;
}
