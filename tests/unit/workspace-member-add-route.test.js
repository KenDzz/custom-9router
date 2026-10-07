import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/workspaces/[id]/members/route.js";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRole: vi.fn(),
  getUserByIdentifier: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: mocks.requireWorkspaceRole }));
vi.mock("@/lib/db/repos/usersRepo.js", () => ({ getUserByIdentifier: mocks.getUserByIdentifier }));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ addMember: mocks.addMember }));

function addRequest(body) {
  return new Request("http://localhost/api/workspaces/workspace-1/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "workspace-1" }) };

describe("add workspace member with a daily token limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceRole.mockResolvedValue({ member: { role: "owner" } });
    mocks.getUserByIdentifier.mockResolvedValue({ id: "new-user" });
  });

  it("allows an owner to set an integer quota when adding a member", async () => {
    const response = await POST(addRequest({ identifier: "new@example.com", role: "member", dailyTokenLimit: 1_250_000 }), context);
    expect(response.status).toBe(201);
    expect(mocks.addMember).toHaveBeenCalledWith("workspace-1", "new-user", "member", { dailyTokenLimit: 1_250_000 });
  });

  it("rejects invalid quota values before adding a member", async () => {
    for (const dailyTokenLimit of [-1, 1.5, "100", 1_000_000_000_001]) {
      const response = await POST(addRequest({ identifier: "new@example.com", dailyTokenLimit }), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("does not let an admin set a quota", async () => {
    mocks.requireWorkspaceRole.mockResolvedValue({ member: { role: "admin" } });
    const response = await POST(addRequest({ identifier: "new@example.com", dailyTokenLimit: 50 }), context);
    expect(response.status).toBe(403);
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("keeps adding a member without a quota available to admins", async () => {
    mocks.requireWorkspaceRole.mockResolvedValue({ member: { role: "admin" } });
    const response = await POST(addRequest({ identifier: "new@example.com" }), context);
    expect(response.status).toBe(201);
    expect(mocks.addMember).toHaveBeenCalledWith("workspace-1", "new-user", "member", undefined);
  });
});
