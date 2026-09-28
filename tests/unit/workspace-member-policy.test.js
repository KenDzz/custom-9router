import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardAuthSession: vi.fn(),
  getMember: vi.fn(),
  getUserById: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: mocks.getDashboardAuthSession,
  verifyDashboardAuthToken: vi.fn(async () => true),
}));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ getMember: mocks.getMember }));
vi.mock("@/lib/db/repos/usersRepo.js", () => ({ getUserById: mocks.getUserById }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-test") }));

const { proxy } = await import("@/dashboardGuard.js");
const { NextRequest } = await import("next/server");

function request(pathname, method = "GET") {
  return new NextRequest(`http://localhost:20127${pathname}`, {
    method, headers: { cookie: "auth_token=test", host: "localhost:20127", "x-9r-cli-token": "cli-test" },
  });
}

beforeEach(() => {
  mocks.getDashboardAuthSession.mockResolvedValue({ userId: "user", activeWorkspaceId: "workspace" });
  mocks.getMember.mockResolvedValue({ role: "member" });
  mocks.getUserById.mockResolvedValue({ id: "user", isActive: true });
  mocks.getSettings.mockResolvedValue({ requireLogin: false });
});

describe("member access enforced before legacy bypasses", () => {
  it.each(["/api/settings", "/api/providers", "/api/keys", "/api/usage/stats", "/api/workspaces/other/members"])("blocks %s with a member session", async (pathname) => {
    expect((await proxy(request(pathname))).status).toBe(403);
  });
  it.each(["/api/shutdown", "/api/version/shutdown", "/api/settings/database", "/api/oauth/cursor/auto-import"])("blocks privileged %s despite a CLI token", async (pathname) => {
    expect((await proxy(request(pathname, "POST"))).status).toBe(403);
  });
  it("allows personal key management and workspace switching", async () => {
    expect((await proxy(request("/api/member/keys", "POST"))).status).toBe(200);
    expect((await proxy(request("/api/auth/workspace", "POST"))).status).toBe(200);
  });
  it("does not allow a member to create an unrestricted owner workspace", async () => {
    expect((await proxy(request("/api/workspaces", "POST"))).status).toBe(403);
  });
  it("redirects restricted pages even with requireLogin disabled", async () => {
    const response = await proxy(request("/dashboard/members"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard/member");
  });
  it("preserves owner access", async () => {
    mocks.getMember.mockResolvedValue({ role: "owner" });
    expect((await proxy(request("/api/providers"))).status).toBe(200);
  });
  it("fails closed for revoked membership and inactive accounts", async () => {
    mocks.getMember.mockResolvedValue(null);
    expect((await proxy(request("/api/settings"))).status).toBe(403);
    mocks.getUserById.mockResolvedValue({ id: "user", isActive: false });
    expect((await proxy(request("/api/member/keys"))).status).toBe(401);
  });
});
