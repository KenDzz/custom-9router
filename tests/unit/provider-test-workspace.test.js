import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/providers/[id]/test/route.js";
import { requireWorkspaceId } from "../../src/lib/workspaces/requestContext.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMember: vi.fn(),
  testSingleConnection: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ getMember: mocks.getMember }));
vi.mock("../../src/app/api/providers/[id]/test/testUtils.js", () => ({
  testSingleConnection: mocks.testSingleConnection,
}));

const request = new Request("http://localhost/api/providers/connection-1/test", { method: "POST" });
const context = { params: Promise.resolve({ id: "connection-1" }) };

describe("provider connection test workspace boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeWorkspaceId: "workspace-1" },
    });
    mocks.getMember.mockResolvedValue({ role: "admin" });
    mocks.testSingleConnection.mockImplementation(async () => ({
      valid: requireWorkspaceId() === "workspace-1",
      error: null,
    }));
  });

  it("runs the connection test in the authorized workspace", async () => {
    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, error: null, refreshed: false });
    expect(mocks.getMember).toHaveBeenCalledWith("workspace-1", "user-1");
    expect(mocks.testSingleConnection).toHaveBeenCalledWith("connection-1");
  });

  it("does not test connections for members without admin access", async () => {
    mocks.getMember.mockResolvedValue({ role: "member" });

    const response = await POST(request, context);

    expect(response.status).toBe(403);
    expect(mocks.testSingleConnection).not.toHaveBeenCalled();
  });
});
