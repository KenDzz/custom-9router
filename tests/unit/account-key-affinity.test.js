import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const { pickAffinityConnection, affinityKeyFromApiKey } = await import("@/sse/services/accountAffinity.js");

const MODEL = "claude-sonnet-5-5";
const ACCOUNTS = ["acc-a", "acc-b", "acc-c"].map((id, i) => ({
  id,
  provider: "claude",
  isActive: true,
  priority: i + 1,
}));
const keys = Array.from({ length: 30 }, (_, i) => affinityKeyFromApiKey(`sk-test-${i}`));

function connections() {
  return ACCOUNTS.map((c) => ({ ...c }));
}

async function pick(affinityKey, exclude = null) {
  const creds = await getProviderCredentials("claude", exclude, MODEL, { affinityKey });
  return creds?.connectionId;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockImplementation(async () => connections());
  mocks.getSettings.mockResolvedValue({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 });
});

describe("affinityKeyFromApiKey", () => {
  it("is stable, opaque and empty for a missing key", () => {
    const key = affinityKeyFromApiKey("sk-secret-value");
    expect(key).toBe(affinityKeyFromApiKey("sk-secret-value"));
    expect(key).toMatch(/^key:[0-9a-f]{32}$/);
    expect(key).not.toContain("sk-secret-value");
    expect(affinityKeyFromApiKey("sk-other")).not.toBe(key);
    expect(affinityKeyFromApiKey(null)).toBeNull();
    expect(affinityKeyFromApiKey("")).toBeNull();
  });
});

describe("pickAffinityConnection", () => {
  it("returns null without a key or connections", () => {
    expect(pickAffinityConnection(connections(), null)).toBeNull();
    expect(pickAffinityConnection([], keys[0])).toBeNull();
  });

  it("does not depend on connection order", () => {
    for (const key of keys) {
      const forward = pickAffinityConnection(connections(), key).id;
      const reversed = pickAffinityConnection(connections().reverse(), key).id;
      expect(reversed).toBe(forward);
    }
  });

  it("spreads keys over every account", () => {
    const used = new Set(keys.map((key) => pickAffinityConnection(connections(), key).id));
    expect(used).toEqual(new Set(["acc-a", "acc-b", "acc-c"]));
  });

  it("moves only the keys of a removed account", () => {
    const full = connections();
    const withoutB = full.filter((c) => c.id !== "acc-b");
    for (const key of keys) {
      const before = pickAffinityConnection(full, key).id;
      const after = pickAffinityConnection(withoutB, key).id;
      if (before !== "acc-b") expect(after).toBe(before);
      else expect(after).not.toBe("acc-b");
    }
  });
});

describe("getProviderCredentials key affinity", () => {
  it("keeps the same key on the same account across many requests", async () => {
    const first = await pick(keys[0]);
    for (let i = 0; i < 10; i += 1) {
      expect(await pick(keys[0])).toBe(first);
    }
    // Rotation counter is left alone; only lastUsedAt is refreshed.
    for (const [, update] of mocks.updateProviderConnection.mock.calls) {
      expect(update).toEqual({ lastUsedAt: expect.any(String) });
    }
  });

  it("falls over when the account is excluded and returns once it is back", async () => {
    const home = await pick(keys[1]);
    const fallback = await pick(keys[1], new Set([home]));
    expect(fallback).toBeTruthy();
    expect(fallback).not.toBe(home);
    expect(await pick(keys[1])).toBe(home);
  });

  it("skips an account whose model is locked", async () => {
    const home = await pick(keys[2]);
    const lockUntil = new Date(Date.now() + 60_000).toISOString();
    mocks.getProviderConnections.mockImplementation(async () =>
      connections().map((c) => (c.id === home ? { ...c, [`modelLock_${MODEL}`]: lockUntil } : c))
    );
    const moved = await pick(keys[2]);
    expect(moved).toBeTruthy();
    expect(moved).not.toBe(home);
  });

  it("keeps the old rotation for requests without a key", async () => {
    await pick(null);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ consecutiveUseCount: 1 })
    );
  });

  it("is disabled by the global setting", async () => {
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 1,
      roundRobinKeyAffinity: false,
    });
    await pick(keys[0]);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ consecutiveUseCount: 1 })
    );
  });

  it("lets a per-provider override turn it off", async () => {
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      providerStrategies: { claude: { keyAffinity: false } },
    });
    await pick(keys[0]);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ consecutiveUseCount: 1 })
    );
  });

  it("does not change fill-first", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
    for (const key of keys.slice(0, 5)) {
      expect(await pick(key)).toBe("acc-a");
    }
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still honours a pinned connection first", async () => {
    const home = await pick(keys[3]);
    const other = ACCOUNTS.map((c) => c.id).find((id) => id !== home);
    const creds = await getProviderCredentials("claude", null, MODEL, {
      affinityKey: keys[3],
      preferredConnectionId: other,
    });
    expect(creds.connectionId).toBe(other);
  });
});
