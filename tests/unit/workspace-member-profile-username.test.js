import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireWorkspaceRole: vi.fn() }));
vi.mock("@/lib/auth/workspaceAuth.js", () => ({ requireWorkspaceRole: mocks.requireWorkspaceRole }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth/dashboardSession.js", () => ({
  setDashboardAuthCookie: vi.fn(), getDashboardAuthSession: vi.fn(async () => null),
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let users;
let workspaces;
let owner;
let workspace;
let register;
let patch;
let sequence = 0;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-profile-username-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  users = await import("@/lib/db/repos/usersRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  register = (await import("../../src/app/api/auth/invite/accept/route.js")).POST;
  patch = (await import("../../src/app/api/workspaces/[id]/members/[userId]/profile/route.js")).PATCH;
  await db.initDb();
  owner = await users.createUser({ username: "profile-owner", email: "owner@example.com" });
  workspace = await workspaces.createWorkspace("Username compatibility", owner.id);
  mocks.requireWorkspaceRole.mockResolvedValue({ user: owner });
});

afterAll(async () => {
  await db?.closeDb?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function request(body, method = "POST") {
  return new Request("http://localhost/api/test", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function inviteRequest(username) {
  const invite = await workspaces.createInvite(workspace.id, `new-${++sequence}@example.com`, "member", owner.id);
  return request({ token: invite.token, username, password: "test-password" });
}

function update(userId, body) {
  return patch(request(body, "PATCH"), { params: Promise.resolve({ id: workspace.id, userId }) });
}

describe("registration and member update username compatibility", () => {
  it.each(["a", "ab", "Person+tag@Example.com", "Nguyễn Văn An", "a".repeat(65)])(
    "updates a quota without rejecting the registered username %s", async (username) => {
      const registered = await register(await inviteRequest(`  ${username}  `));
      expect(registered.status).toBe(200);
      const { user } = await registered.json();
      const normalized = username.toLowerCase();
      expect(user.username).toBe(normalized);
      const updated = await update(user.id, { username: user.username, displayName: "Updated member", dailyTokenLimit: 123_456 });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        user: { username: normalized, displayName: "Updated member" }, member: { dailyTokenLimit: 123_456 },
      });
    },
  );

  it("normalizes renamed usernames and still rejects duplicate usernames", async () => {
    const user = await users.createUser({ username: "rename-member", email: "rename@example.com" });
    await workspaces.addMember(workspace.id, user.id, "member");
    const renamed = await update(user.id, { username: "  NEW+Name@Example.com  " });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).user.username).toBe("new+name@example.com");
    const conflict = await update(user.id, { username: " PROFILE-OWNER " });
    expect(conflict.status).toBe(409);
    expect((await users.getUserById(user.id)).username).toBe("new+name@example.com");
  });

  it.each(["", "   ", null, 123, {}])("rejects an empty or non-string username in both flows: %j", async (username) => {
    const registered = await register(await inviteRequest(username));
    expect(registered.status).toBe(400);
    expect((await update(owner.id, { username })).status).toBe(400);
    expect((await users.getUserById(owner.id)).username).toBe("profile-owner");
  });
});
