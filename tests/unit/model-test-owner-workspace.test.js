import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/models/test/route.js";
import { requireWorkspaceId } from "../../src/lib/workspaces/requestContext.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getMember: vi.fn(),
  handleChat: vi.fn(),
}));

vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/repos/workspacesRepo.js", () => ({ getMember: mocks.getMember }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));

function request() {
  return new Request("http://localhost/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "cc/claude-sonnet-5-5" }),
  });
}

describe("owner model test workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      user: { id: "owner-1" },
      session: { activeWorkspaceId: "workspace-1" },
    });
    mocks.getMember.mockResolvedValue({ role: "owner" });
    mocks.handleChat.mockImplementation(async () => {
      if (requireWorkspaceId() !== "workspace-1") throw new Error("Wrong workspace");
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    });
  });

  it("runs the model probe in the owner's active workspace", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.getMember).toHaveBeenCalledWith("workspace-1", "owner-1");
    expect(mocks.handleChat).toHaveBeenCalledOnce();
  });

  it("does not run a probe for a non-owner", async () => {
    mocks.getMember.mockResolvedValue({ role: "admin" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });
});
