import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/workspaces/[id]/invites/route.js";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRole: vi.fn(),
  createInvite: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: mocks.requireWorkspaceRole }));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ createInvite: mocks.createInvite }));

const context = { params: Promise.resolve({ id: "workspace-1" }) };

function inviteRequest(body) {
  return new Request("http://localhost/api/workspaces/workspace-1/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("invitation daily token limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceRole.mockResolvedValue({ user: { id: "owner-1" }, member: { role: "owner" } });
    mocks.createInvite.mockResolvedValue({ id: "invite-1", dailyTokenLimit: 1_250_000 });
  });

  it("lets an owner set a quota for a pending invitation", async () => {
    const response = await POST(inviteRequest({ email: "new@example.com", dailyTokenLimit: 1_250_000 }), context);
    expect(response.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "member", "owner-1", { dailyTokenLimit: 1_250_000 });
  });

  it("rejects malformed quotas", async () => {
    for (const dailyTokenLimit of [null, -1, 1.5, "100", 1_000_000_000_001]) {
      const response = await POST(inviteRequest({ email: "new@example.com", dailyTokenLimit }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("prevents an admin from setting a quota while preserving invitations without one", async () => {
    mocks.requireWorkspaceRole.mockResolvedValue({ user: { id: "admin-1" }, member: { role: "admin" } });
    const denied = await POST(inviteRequest({ email: "new@example.com", dailyTokenLimit: 100 }), context);
    expect(denied.status).toBe(403);
    expect(mocks.createInvite).not.toHaveBeenCalled();

    const allowed = await POST(inviteRequest({ email: "new@example.com" }), context);
    expect(allowed.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "member", "admin-1", undefined);
  });
});
