import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as grantGift } from "../../src/app/api/workspaces/[id]/members/[userId]/gifts/route.js";
import { POST as ownerReset } from "../../src/app/api/workspaces/[id]/members/[userId]/usage-reset/route.js";
import { POST as memberReset } from "../../src/app/api/member/reset-usage/route.js";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRole: vi.fn(),
  withDashboardWorkspace: vi.fn(),
  createMemberGift: vi.fn(),
  resetMemberQuotaUsage: vi.fn(),
  redeemMemberResetGift: vi.fn(),
  getMemberTokenStatus: vi.fn(),
  getMemberDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: mocks.requireWorkspaceRole }));
vi.mock("@/lib/workspaces/requestContext.js", () => ({ withDashboardWorkspace: mocks.withDashboardWorkspace }));
vi.mock("@/lib/db/repos/memberGiftsRepo.js", () => ({
  createMemberGift: mocks.createMemberGift,
  listMemberGifts: vi.fn(),
  resetMemberQuotaUsage: mocks.resetMemberQuotaUsage,
  redeemMemberResetGift: mocks.redeemMemberResetGift,
}));
vi.mock("@/lib/db/repos/memberAccessRepo.js", () => ({
  getMemberTokenStatus: mocks.getMemberTokenStatus,
  getMemberDashboard: mocks.getMemberDashboard,
}));

const context = { params: Promise.resolve({ id: "workspace-1", userId: "member-1" }) };

describe("member gift API permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceRole.mockResolvedValue({ user: { id: "owner-1" } });
    mocks.withDashboardWorkspace.mockImplementation((_request, _role, handler) =>
      handler({ user: { id: "member-1" }, session: { activeWorkspaceId: "workspace-1" } }));
    mocks.getMemberTokenStatus.mockResolvedValue({ usedTokens: 0 });
    mocks.getMemberDashboard.mockResolvedValue({ tokenStatus: { usedTokens: 0 } });
  });

  it("requires owner role before granting or directly resetting", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    mocks.requireWorkspaceRole.mockResolvedValue({ error: denied });
    const request = new Request("http://localhost/gifts", { method: "POST", body: "{}" });
    expect((await grantGift(request, context)).status).toBe(403);
    expect((await ownerReset(request, context)).status).toBe(403);
    expect(mocks.requireWorkspaceRole).toHaveBeenCalledWith(request, "workspace-1", "owner");
    expect(mocks.createMemberGift).not.toHaveBeenCalled();
    expect(mocks.resetMemberQuotaUsage).not.toHaveBeenCalled();
  });

  it("assigns the gift to the target member with the authenticated owner as creator", async () => {
    const gift = { type: "reset", amount: 2, startsAt: "2030-01-01T12:30:00Z", endsAt: "2030-01-02T12:30:00Z" };
    mocks.createMemberGift.mockResolvedValue({ id: "gift-1", ...gift });
    const request = new Request("http://localhost/gifts", { method: "POST", body: JSON.stringify(gift) });
    expect((await grantGift(request, context)).status).toBe(201);
    expect(mocks.createMemberGift).toHaveBeenCalledWith("workspace-1", "member-1", gift, "owner-1");
  });

  it("redeems only for the signed-in member and keeps direct owner reset separate", async () => {
    const request = new Request("http://localhost/reset", { method: "POST" });
    expect((await memberReset(request)).status).toBe(200);
    expect(mocks.withDashboardWorkspace).toHaveBeenCalledWith(request, "member", expect.any(Function));
    expect(mocks.redeemMemberResetGift).toHaveBeenCalledWith("workspace-1", "member-1");
    expect(mocks.resetMemberQuotaUsage).not.toHaveBeenCalled();

    expect((await ownerReset(request, context)).status).toBe(200);
    expect(mocks.resetMemberQuotaUsage).toHaveBeenCalledWith("workspace-1", "member-1");
    expect(mocks.redeemMemberResetGift).toHaveBeenCalledTimes(1);
  });
});
