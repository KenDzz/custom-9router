import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/workspaces/[id]/invites/route.js";

const mocks = vi.hoisted(() => ({
  requireWorkspaceAdmin: vi.fn(),
  createInvite: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: vi.fn(), requireWorkspaceAdmin: mocks.requireWorkspaceAdmin }));
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
    mocks.requireWorkspaceAdmin.mockResolvedValue({ user: { id: "admin-1" }, member: { role: "admin" } });
    mocks.createInvite.mockResolvedValue({ id: "invite-1", dailyTokenLimit: 1_250_000 });
  });

  it("lets an admin set a quota for a pending invitation", async () => {
    const response = await POST(inviteRequest({ email: "new@example.com", dailyTokenLimit: 1_250_000 }), context);
    expect(response.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "member", "admin-1", { dailyTokenLimit: 1_250_000 });
  });

  it("rejects malformed quotas", async () => {
    for (const dailyTokenLimit of [null, -1, 1.5, "100", 1_000_000_000_001]) {
      const response = await POST(inviteRequest({ email: "new@example.com", dailyTokenLimit }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("preserves invitations without a quota", async () => {
    const allowed = await POST(inviteRequest({ email: "new@example.com" }), context);
    expect(allowed.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "member", "admin-1", undefined);
  });
});
