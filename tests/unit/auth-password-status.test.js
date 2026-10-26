import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardAuthSession: vi.fn(), getUserById: vi.fn(), verifyPassword: vi.fn(),
  isLocalRequest: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ getDashboardAuthSession: mocks.getDashboardAuthSession }));
vi.mock("@/lib/db/repos/usersRepo.js", () => ({ getUserById: mocks.getUserById, verifyPassword: mocks.verifyPassword }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({ requireLogin: false }) }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
const { GET } = await import("@/app/api/auth/status/route.js");

beforeEach(() => {
  mocks.getDashboardAuthSession.mockResolvedValue({ userId: "member", loginMethod: "password" });
  mocks.getUserById.mockResolvedValue({ id: "member", isActive: true, passwordHash: "hash" });
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.isLocalRequest.mockReturnValue(false);
});

describe("password change status across tabs", () => {
  it("restores the required password step after a reload even with login disabled", async () => {
    const response = await GET({});
    expect(await response.json()).toMatchObject({ requireLogin: false, mustChangePassword: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("clears the requirement when the stored password changes", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    expect(await (await GET({})).json()).toMatchObject({ mustChangePassword: false });
  });
  it("does not force an anonymous visitor into a password change", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);
    expect(await (await GET({})).json()).toMatchObject({ mustChangePassword: false });
  });
});
