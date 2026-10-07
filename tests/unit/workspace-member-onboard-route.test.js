import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/workspaces/[id]/members/onboard/route.js";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRole: vi.fn(),
  getUserByIdentifier: vi.fn(),
  addMember: vi.fn(),
  createInvite: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: mocks.requireWorkspaceRole }));
vi.mock("@/lib/db/repos/usersRepo.js", () => ({ getUserByIdentifier: mocks.getUserByIdentifier }));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ addMember: mocks.addMember, createInvite: mocks.createInvite }));

const context = { params: Promise.resolve({ id: "workspace-1" }) };

function request(body) {
  return new Request("http://localhost/api/workspaces/workspace-1/members/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("unified member onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceRole.mockResolvedValue({ user: { id: "owner-1" }, member: { role: "owner" } });
    mocks.createInvite.mockResolvedValue({ id: "invite-1", token: "raw-token" });
  });

  it("adds an existing account immediately", async () => {
    mocks.getUserByIdentifier.mockResolvedValue({ id: "existing-1" });
    const response = await POST(request({ identifier: "existing@example.com", dailyTokenLimit: 1_000_000 }), context);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ mode: "added" });
    expect(mocks.addMember).toHaveBeenCalledWith("workspace-1", "existing-1", "member", { dailyTokenLimit: 1_000_000 });
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("creates an invitation for a new email address", async () => {
    mocks.getUserByIdentifier.mockResolvedValue(null);
    const response = await POST(request({ identifier: " new@example.com ", role: "admin", dailyTokenLimit: 500 }), context);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ mode: "invited", invite: { token: "raw-token" } });
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "admin", "owner-1", { dailyTokenLimit: 500 });
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("asks for an email when a username has no account", async () => {
    mocks.getUserByIdentifier.mockResolvedValue(null);
    const response = await POST(request({ identifier: "unknown-user" }), context);

    expect(response.status).toBe(404);
    expect(mocks.addMember).not.toHaveBeenCalled();
    expect(mocks.createInvite).not.toHaveBeenCalled();
  });

  it("lets an admin add or invite without a quota but rejects quota changes", async () => {
    mocks.requireWorkspaceRole.mockResolvedValue({ user: { id: "admin-1" }, member: { role: "admin" } });
    mocks.getUserByIdentifier.mockResolvedValue(null);

    const denied = await POST(request({ identifier: "new@example.com", dailyTokenLimit: 10 }), context);
    expect(denied.status).toBe(403);
    expect(mocks.createInvite).not.toHaveBeenCalled();

    const allowed = await POST(request({ identifier: "new@example.com" }), context);
    expect(allowed.status).toBe(201);
    expect(mocks.createInvite).toHaveBeenCalledWith("workspace-1", "new@example.com", "member", "admin-1", undefined);
  });

  it("rejects invalid limits before adding or inviting", async () => {
    for (const dailyTokenLimit of [null, -1, 1.5, "100", 1_000_000_000_001]) {
      const response = await POST(request({ identifier: "new@example.com", dailyTokenLimit }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.getUserByIdentifier).not.toHaveBeenCalled();
  });
});
