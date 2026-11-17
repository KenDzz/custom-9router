import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: vi.fn(),
  usage: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.usage }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.connections }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/lib/workspaces/requestContext.js", () => ({ withDashboardWorkspace: mocks.workspace }));

const { GET } = await import("@/app/api/member/quota/route.js");
const { getMemberProviderQuota } = await import("@/lib/workspaces/memberProviderQuota.js");

describe("read-only member provider quota", () => {
  it("returns only provider-level quota and reset time, without identifiers or raw provider data", async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    mocks.workspace.mockImplementation(async (_request, role, callback) => {
      expect(role).toBe("member");
      return callback({ session: { activeWorkspaceId: "member-quota-test" } });
    });
    mocks.connections.mockResolvedValue([
      { id: "private-1", provider: "codex", authType: "oauth", accessToken: "secret-1" },
      { id: "private-2", provider: "codex", authType: "oauth", accessToken: "secret-2" },
      { id: "private-3", provider: "claude", authType: "oauth", email: "private@example.com" },
    ]);
    mocks.usage.mockImplementation(async ({ id }) => id === "private-3"
      ? { message: "Authentication error: private@example.com" }
      : { plan: "private plan", quotas: {
        session: { remaining: id === "private-1" ? 0 : 75, resetAt },
        weekly: { remaining: 92 },
      } });
    const [first, second] = await Promise.all([GET({}), GET({})]);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const expected = { providers: [
      { provider: "claude", remainingPercent: null, resetAt: null, unlimited: false },
      { provider: "codex", remainingPercent: 75, resetAt, unlimited: false },
    ] };
    expect(await first.json()).toEqual(expected);
    expect(await second.json()).toEqual(expected);
    expect(mocks.connections).toHaveBeenCalledExactlyOnceWith({ isActive: true });
    expect(mocks.usage).toHaveBeenCalledTimes(3);

    mocks.connections.mockResolvedValue([]);
    expect(await getMemberProviderQuota("different-workspace")).toEqual([]);
  });

  it("returns an authentication error without loading quota when access is denied", async () => {
    mocks.connections.mockClear();
    mocks.workspace.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET({})).status).toBe(401);
    expect(mocks.connections).not.toHaveBeenCalled();
  });
});
