import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_ID, MIGRATED_ADMIN_USER_ID } from "@/lib/workspaces/constants.js";

vi.mock("@/lib/auth/dashboardSession.js", () => ({
  getDashboardAuthSession: async (token) => token ? JSON.parse(token) : null,
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let users;
let workspaces;
let owner;
let invited;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-workspace-rbac-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  users = await import("@/lib/db/repos/usersRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  await db.initDb();
  owner = await users.createUser({
    username: "workspace-owner",
    email: "owner@example.com",
    passwordHash: bcrypt.hashSync("owner-password", 4),
  });
  invited = await users.createUser({
    username: "invited-user",
    email: "invited@example.com",
    passwordHash: bcrypt.hashSync("invited-password", 4),
  });
});

afterAll(async () => {
  await db?.closeDb?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("workspace RBAC repository invariants", () => {
  it("applies an owner's invitation quota when the user accepts", async () => {
    const workspace = await workspaces.createWorkspace("Limited invite workspace", owner.id);
    const invite = await workspaces.createInvite(workspace.id, invited.email, "member", owner.id, { dailyTokenLimit: 1_250_000 });

    expect(invite.dailyTokenLimit).toBe(1_250_000);
    expect((await workspaces.getPendingInviteByToken(invite.token)).dailyTokenLimit).toBe(1_250_000);
    await workspaces.acceptInvite(invite.id, invited.id);
    expect(await workspaces.getMember(workspace.id, invited.id)).toMatchObject({
      role: "member",
      dailyTokenLimit: 1_250_000,
    });
  });

  it("preserves an existing quota when accepting an invitation without one", async () => {
    const workspace = await workspaces.createWorkspace("Legacy invite workspace", owner.id);
    await workspaces.addMember(workspace.id, invited.id, "member", { dailyTokenLimit: 500 });
    const invite = await workspaces.createInvite(workspace.id, invited.email, "admin", owner.id);

    expect(invite.dailyTokenLimit).toBeNull();
    await workspaces.acceptInvite(invite.id, invited.id);
    expect(await workspaces.getMember(workspace.id, invited.id)).toMatchObject({
      role: "admin",
      dailyTokenLimit: 500,
    });
  });

  it("defaults a new member to unlimited when the invitation has no quota", async () => {
    const workspace = await workspaces.createWorkspace("Default invite workspace", owner.id);
    const invite = await workspaces.createInvite(workspace.id, invited.email, "member", owner.id);

    await workspaces.acceptInvite(invite.id, invited.id);
    expect((await workspaces.getMember(workspace.id, invited.id)).dailyTokenLimit).toBe(0);
  });

  it("allows an explicit zero quota on an invitation to remove a prior limit", async () => {
    const workspace = await workspaces.createWorkspace("Unlimited invite workspace", owner.id);
    await workspaces.addMember(workspace.id, invited.id, "member", { dailyTokenLimit: 500 });
    const invite = await workspaces.createInvite(workspace.id, invited.email, "member", owner.id, { dailyTokenLimit: 0 });

    await workspaces.acceptInvite(invite.id, invited.id);
    expect((await workspaces.getMember(workspace.id, invited.id)).dailyTokenLimit).toBe(0);
  });

  it("returns the membership role with each workspace", async () => {
    const workspace = await workspaces.createWorkspace("Role workspace", owner.id);
    const rows = await workspaces.getWorkspacesForUser(owner.id);
    expect(rows).toContainEqual(expect.objectContaining({ id: workspace.id, role: "owner" }));
  });

  it("cannot revoke an invite through a different workspace id", async () => {
    const workspaceA = await workspaces.createWorkspace("Workspace A", owner.id);
    const workspaceB = await workspaces.createWorkspace("Workspace B", owner.id);
    const invite = await workspaces.createInvite(workspaceB.id, invited.email, "member", owner.id);

    await workspaces.revokeInvite(workspaceA.id, invite.id);
    expect(await workspaces.getPendingInviteByToken(invite.token)).toEqual(
      expect.objectContaining({ id: invite.id, workspaceId: workspaceB.id }),
    );

    await workspaces.revokeInvite(workspaceB.id, invite.id);
    expect(await workspaces.getPendingInviteByToken(invite.token)).toBeNull();
  });

  it("rejects accepting an invite as a user with another email", async () => {
    const workspace = await workspaces.createWorkspace("Invite workspace", owner.id);
    const invite = await workspaces.createInvite(workspace.id, invited.email, "member", owner.id);

    await expect(workspaces.acceptInvite(invite.id, owner.id)).rejects.toThrow(
      "invite email does not match user",
    );
    expect(await workspaces.getPendingInviteByToken(invite.token)).not.toBeNull();
  });
});

describe("workspace administration routes", () => {
  function request(userId, activeWorkspaceId, body) {
    return {
      cookies: { get: () => ({ value: JSON.stringify({ userId, activeWorkspaceId }) }) },
      json: async () => body,
    };
  }

  it("denies workspace creation and roster changes to an ordinary owner", async () => {
    const workspace = await workspaces.createWorkspace("Owner restrictions", owner.id);
    await workspaces.addMember(workspace.id, invited.id, "member");
    const context = { params: Promise.resolve({ id: workspace.id, userId: invited.id, inviteId: "pending" }) };
    const req = request(owner.id, workspace.id, {
      name: "Unauthorized", identifier: invited.username, email: "someone@example.com", role: "admin",
    });
    const routes = [
      (await import("@/app/api/workspaces/route.js")).POST,
      (await import("@/app/api/workspaces/[id]/route.js")).DELETE,
      (await import("@/app/api/workspaces/[id]/members/route.js")).POST,
      (await import("@/app/api/workspaces/[id]/members/onboard/route.js")).POST,
      (await import("@/app/api/workspaces/[id]/invites/route.js")).POST,
      (await import("@/app/api/workspaces/[id]/invites/[inviteId]/route.js")).DELETE,
      (await import("@/app/api/workspaces/[id]/members/[userId]/route.js")).PATCH,
      (await import("@/app/api/workspaces/[id]/members/[userId]/route.js")).DELETE,
      (await import("@/app/api/workspaces/[id]/members/[userId]/profile/route.js")).PATCH,
    ];
    for (const route of routes) expect((await route(req, context)).status).toBe(403);
    expect(await workspaces.getMember(workspace.id, invited.id)).toMatchObject({ role: "member" });
  });

  it("lets an admin create a workspace, add, change and remove a member", async () => {
    const workspace = await workspaces.createWorkspace("Admin membership", invited.id, "admin");
    const { POST: create } = await import("@/app/api/workspaces/route.js");
    const response = await create(request(invited.id, workspace.id, { name: "Managed workspace" }));
    expect(response.status).toBe(201);
    const { workspace: created } = await response.json();
    expect(created.role).toBe("admin");
    expect(await workspaces.getMember(created.id, invited.id)).toMatchObject({ role: "admin" });
    const context = { params: Promise.resolve({ id: created.id, userId: owner.id }) };
    const { POST: add } = await import("@/app/api/workspaces/[id]/members/route.js");
    const { PATCH, DELETE } = await import("@/app/api/workspaces/[id]/members/[userId]/route.js");
    expect((await add(request(invited.id, created.id, { identifier: owner.username }), context)).status).toBe(201);
    expect((await PATCH(request(invited.id, created.id, { role: "admin" }), context)).status).toBe(200);
    expect(await workspaces.getMember(created.id, owner.id)).toMatchObject({ role: "admin" });
    expect((await DELETE(request(invited.id, created.id), context)).status).toBe(200);
    expect(await workspaces.getMember(created.id, owner.id)).toBeNull();
  });

  it("preserves workspace creation for the built-in admin with its legacy owner role", async () => {
    const { POST } = await import("@/app/api/workspaces/route.js");
    const response = await POST(request(MIGRATED_ADMIN_USER_ID, DEFAULT_WORKSPACE_ID, { name: "Built-in admin workspace" }));
    expect(response.status).toBe(201);
  });
});
