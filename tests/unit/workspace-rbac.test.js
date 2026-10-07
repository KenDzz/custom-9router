import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
