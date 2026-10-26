import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardAuthSession: vi.fn(), getUserById: vi.fn(),
  verifyPassword: vi.fn(), setPassword: vi.fn(),
}));
vi.mock("@/lib/auth/dashboardSession.js", () => ({ getDashboardAuthSession: mocks.getDashboardAuthSession }));
vi.mock("@/lib/db/repos/usersRepo.js", () => ({
  getUserById: mocks.getUserById, verifyPassword: mocks.verifyPassword, setPassword: mocks.setPassword,
}));
const { POST } = await import("@/app/api/auth/change-password/route.js");

const request = (body) => ({ cookies: { get: () => ({ value: "session" }) }, json: async () => body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDashboardAuthSession.mockResolvedValue({ userId: "member" });
  mocks.getUserById.mockResolvedValue({ id: "member", isActive: true });
  mocks.verifyPassword.mockImplementation(async (_user, password) => password === "123456");
});

describe("personal password change", () => {
  it("lets a member change only their own password", async () => {
    const response = await POST(request({ currentPassword: "123456", newPassword: "my-new-password", userId: "owner", requireLogin: false }));
    expect(response.status).toBe(200);
    expect(mocks.setPassword).toHaveBeenCalledExactlyOnceWith("member", "my-new-password");
  });

  it.each([null, { userId: "member" }])("rejects missing session or inactive account: %j", async (session) => {
    mocks.getDashboardAuthSession.mockResolvedValue(session);
    mocks.getUserById.mockResolvedValue({ id: "member", isActive: false });
    expect((await POST(request({}))).status).toBe(401);
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("rejects an incorrect current password", async () => {
    expect((await POST(request({ currentPassword: "wrong", newPassword: "my-new-password" }))).status).toBe(401);
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it.each(["short", "x".repeat(73), "é".repeat(37), null])("rejects invalid new password: %j", async (newPassword) => {
    expect((await POST(request({ currentPassword: "123456", newPassword }))).status).toBe(400);
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("rejects reusing a configured initial password", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "configured-seed");
    try {
      expect((await POST(request({ currentPassword: "123456", newPassword: "configured-seed" }))).status).toBe(400);
      expect(mocks.setPassword).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
