import "open-sse/index.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";
import { remainingQuota } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/statusHistory";

const supported = new Set(USAGE_SUPPORTED_PROVIDERS);
const apiKeyProviders = new Set(USAGE_APIKEY_PROVIDERS);
const snapshots = new Map();
const ttl = 5 * 60 * 1000;

function resetAt(quota, now) {
  if (quota.neverExpires || quota.recurring === false || !quota.resetAt) return null;
  const timestamp = new Date(quota.resetAt).getTime();
  return timestamp > now ? timestamp : null;
}

// Minimum across an account's windows, then maximum across the provider's
// active accounts. Never return account identifiers, labels or raw responses.
export function summarizeMemberProviderQuota(provider, observations, now = Date.now()) {
  let best = null;
  for (const quotas of observations) {
    if (!quotas.length || quotas.some((quota) => !quota.unlimited && remainingQuota(quota) === null)) continue;
    const limits = quotas.filter((quota) => !quota.unlimited);
    if (!limits.length) {
      return { provider, remainingPercent: null, resetAt: null, unlimited: true };
    }
    const remainingPercent = Math.min(...limits.map(remainingQuota));
    const resets = limits.filter((quota) => remainingQuota(quota) === remainingPercent)
      .map((quota) => resetAt(quota, now)).filter((value) => value !== null);
    const reset = resets.length ? Math.min(...resets) : null;
    if (!best || remainingPercent > best.remainingPercent
      || (remainingPercent === best.remainingPercent && reset !== null && (best.reset === null || reset < best.reset))) {
      best = { remainingPercent, reset };
    }
  }
  return {
    provider,
    remainingPercent: best?.remainingPercent ?? null,
    resetAt: best?.reset == null ? null : new Date(best.reset).toISOString(),
    unlimited: false,
  };
}

async function readQuota(connection) {
  try {
    const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const data = await getUsageForProvider(connection, proxy);
    if (!data || data.error || data.message) return [];
    return parseQuotaData(connection.provider, data);
  } catch {
    return [];
  }
}

async function collectProviders() {
  const connections = (await getProviderConnections({ isActive: true })).filter(({ provider, authType }) =>
    supported.has(provider) && (authType === "oauth"
      || ((authType === "apikey" || authType === "api_key") && apiKeyProviders.has(provider))));
  const groups = new Map();
  for (const { provider } of connections) {
    if (!groups.has(provider)) groups.set(provider, []);
  }
  for (let offset = 0; offset < connections.length; offset += 5) {
    await Promise.all(connections.slice(offset, offset + 5).map(async (connection) => {
      groups.get(connection.provider).push(await readQuota(connection));
    }));
  }
  return [...groups].map(([provider, observations]) => summarizeMemberProviderQuota(provider, observations))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function getMemberProviderQuota(workspaceId) {
  const cached = snapshots.get(workspaceId);
  if (cached && (cached.pending || cached.expiresAt > Date.now())) return cached.promise;
  const entry = { pending: true, expiresAt: 0 };
  snapshots.delete(workspaceId);
  if (snapshots.size >= 100) {
    const evictable = [...snapshots].find(([, value]) => !value.pending);
    if (evictable) snapshots.delete(evictable[0]);
    else throw new Error("Quota checks are busy");
  }
  entry.promise = collectProviders().then((providers) => {
    entry.pending = false;
    entry.expiresAt = Date.now() + ttl;
    return providers;
  }).catch((error) => {
    snapshots.delete(workspaceId);
    throw error;
  });
  snapshots.set(workspaceId, entry);
  return entry.promise;
}
