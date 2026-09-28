import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { normalizeIdentifier } from "./usersRepo.js";
import { WORKSPACE_ROLES, ROUTING_TABLES } from "../../workspaces/constants.js";

function rowToWorkspace(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault === 1 || row.isDefault === true,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMember(row) {
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    dailyTokenLimit: Number(row.dailyTokenLimit || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.username !== undefined ? { username: row.username } : {}),
    ...(row.email !== undefined ? { email: row.email } : {}),
    ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
  };
}

function rowToInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Workspaces ────────────────────────────────────────────────────────────

export async function getWorkspaceById(id) {
  const db = await getAdapter();
  return rowToWorkspace(db.get(`SELECT * FROM workspaces WHERE id = ?`, [id]));
}

export async function getDefaultWorkspace() {
  const db = await getAdapter();
  return rowToWorkspace(db.get(`SELECT * FROM workspaces WHERE isDefault = 1`));
}

export async function getWorkspacesForUser(userId) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT w.*, m.role, m.dailyTokenLimit FROM workspaces w JOIN workspaceMembers m ON m.workspaceId = w.id WHERE m.userId = ? ORDER BY w.createdAt ASC`,
    [userId]
  );
  return rows.map((row) => ({
    ...rowToWorkspace(row),
    role: row.role,
    dailyTokenLimit: Number(row.dailyTokenLimit || 0),
  }));
}

export async function createWorkspace(name, createdByUserId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const workspace = { id: uuidv4(), name, isDefault: false, createdByUserId, createdAt: now, updatedAt: now };
  db.transaction(() => {
    db.run(
      `INSERT INTO workspaces(id, name, isDefault, createdByUserId, createdAt, updatedAt) VALUES(?, ?, 0, ?, ?, ?)`,
      [workspace.id, name, createdByUserId, now, now]
    );
    db.run(
      `INSERT INTO workspaceMembers(workspaceId, userId, role, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [workspace.id, createdByUserId, WORKSPACE_ROLES.OWNER, now, now]
    );
  });
  return workspace;
}

export async function renameWorkspace(id, name) {
  const db = await getAdapter();
  db.run(`UPDATE workspaces SET name = ?, updatedAt = ? WHERE id = ?`, [name, new Date().toISOString(), id]);
}

// Deletes the workspace, its members/invites, and every routing row that
// belonged to it. Refuses the Default workspace — it is not deletable.
export async function deleteWorkspace(id) {
  const db = await getAdapter();
  const workspace = await getWorkspaceById(id);
  if (!workspace) return;
  if (workspace.isDefault) throw new Error("cannot delete the Default workspace");
  db.transaction(() => {
    for (const table of ROUTING_TABLES) db.run(`DELETE FROM ${table} WHERE workspaceId = ?`, [id]);
    db.run(`DELETE FROM workspaceKv WHERE workspaceId = ?`, [id]);
    db.run(`DELETE FROM workspaceUsageMeta WHERE workspaceId = ?`, [id]);
    db.run(`DELETE FROM workspaceInvites WHERE workspaceId = ?`, [id]);
    db.run(`DELETE FROM workspaceMembers WHERE workspaceId = ?`, [id]);
    db.run(`DELETE FROM workspaces WHERE id = ?`, [id]);
  });
}

// ─── Members ───────────────────────────────────────────────────────────────

export async function getMember(workspaceId, userId) {
  const db = await getAdapter();
  return rowToMember(db.get(`SELECT * FROM workspaceMembers WHERE workspaceId = ? AND userId = ?`, [workspaceId, userId]));
}

export async function getMembers(workspaceId) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT m.*, u.username, u.email, u.displayName FROM workspaceMembers m JOIN users u ON u.id = m.userId WHERE m.workspaceId = ? ORDER BY m.createdAt ASC`,
    [workspaceId]
  );
  return rows.map((r) => ({ ...rowToMember(r), username: r.username, email: r.email, displayName: r.displayName }));
}

export async function countOwners(workspaceId) {
  const db = await getAdapter();
  return db.get(`SELECT COUNT(*) AS c FROM workspaceMembers WHERE workspaceId = ? AND role = ?`, [workspaceId, WORKSPACE_ROLES.OWNER])?.c ?? 0;
}

export async function addMember(workspaceId, userId, role) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO workspaceMembers(workspaceId, userId, role, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(workspaceId, userId) DO UPDATE SET role = excluded.role, updatedAt = excluded.updatedAt`,
    [workspaceId, userId, role, now, now]
  );
}

// Refuses to demote/remove the last remaining owner of a workspace.
export async function updateMemberRole(workspaceId, userId, role) {
  const db = await getAdapter();
  let error = null;
  db.transaction(() => {
    const current = db.get(`SELECT role FROM workspaceMembers WHERE workspaceId = ? AND userId = ?`, [workspaceId, userId]);
    if (!current) { error = new Error("member not found"); return; }
    if (current.role === WORKSPACE_ROLES.OWNER && role !== WORKSPACE_ROLES.OWNER) {
      const owners = db.get(`SELECT COUNT(*) AS c FROM workspaceMembers WHERE workspaceId = ? AND role = ?`, [workspaceId, WORKSPACE_ROLES.OWNER])?.c ?? 0;
      if (owners <= 1) { error = new Error("cannot demote the last owner"); return; }
    }
    db.run(`UPDATE workspaceMembers SET role = ?, updatedAt = ? WHERE workspaceId = ? AND userId = ?`, [role, new Date().toISOString(), workspaceId, userId]);
  });
  if (error) throw error;
}

export async function updateMemberDailyTokenLimit(workspaceId, userId, dailyTokenLimit) {
  const db = await getAdapter();
  const limit = Number(dailyTokenLimit);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("daily token limit must be a non-negative integer");
  const result = db.run(
    `UPDATE workspaceMembers SET dailyTokenLimit = ?, updatedAt = ? WHERE workspaceId = ? AND userId = ?`,
    [limit, new Date().toISOString(), workspaceId, userId],
  );
  if ((result?.changes ?? 0) === 0) throw new Error("member not found");
  return getMember(workspaceId, userId);
}

export async function removeMember(workspaceId, userId) {
  const db = await getAdapter();
  let error = null;
  db.transaction(() => {
    const current = db.get(`SELECT role FROM workspaceMembers WHERE workspaceId = ? AND userId = ?`, [workspaceId, userId]);
    if (!current) return;
    if (current.role === WORKSPACE_ROLES.OWNER) {
      const owners = db.get(`SELECT COUNT(*) AS c FROM workspaceMembers WHERE workspaceId = ? AND role = ?`, [workspaceId, WORKSPACE_ROLES.OWNER])?.c ?? 0;
      if (owners <= 1) { error = new Error("cannot remove the last owner"); return; }
    }
    db.run(`UPDATE apiKeys SET isActive = 0 WHERE workspaceId = ? AND userId = ?`, [workspaceId, userId]);
    db.run(`DELETE FROM workspaceMembers WHERE workspaceId = ? AND userId = ?`, [workspaceId, userId]);
  });
  if (error) throw error;
}

// ─── Invites ───────────────────────────────────────────────────────────────
// Token hash only is persisted; the raw token is returned once, at creation.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(workspaceId, email, role, invitedByUserId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const token = crypto.randomBytes(32).toString("base64url");
  const invite = {
    id: uuidv4(),
    workspaceId,
    email: normalizeIdentifier(email),
    role,
    tokenHash: hashToken(token),
    invitedByUserId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO workspaceInvites(id, workspaceId, email, role, tokenHash, invitedByUserId, expiresAt, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invite.id, invite.workspaceId, invite.email, invite.role, invite.tokenHash, invite.invitedByUserId, invite.expiresAt, now, now]
  );
  return { ...rowToInvite(invite), token };
}

export async function getInvitesForWorkspace(workspaceId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM workspaceInvites WHERE workspaceId = ? ORDER BY createdAt DESC`, [workspaceId]).map(rowToInvite);
}

// Looks up a pending (unaccepted, unrevoked, unexpired) invite by raw token.
export async function getPendingInviteByToken(token) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM workspaceInvites WHERE tokenHash = ?`, [hashToken(token)]);
  if (!row) return null;
  const invite = rowToInvite(row);
  if (invite.acceptedAt || invite.revokedAt) return null;
  if (new Date(invite.expiresAt).getTime() < Date.now()) return null;
  return invite;
}

export async function acceptInvite(inviteId, userId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    const row = db.get(`SELECT * FROM workspaceInvites WHERE id = ?`, [inviteId]);
    if (!row) throw new Error("invite not found");
    if (row.acceptedAt || row.revokedAt) throw new Error("invite no longer valid");
    if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error("invite expired");
    const user = db.get(`SELECT email FROM users WHERE id = ?`, [userId]);
    if (!user || normalizeIdentifier(user.email) !== normalizeIdentifier(row.email)) {
      throw new Error("invite email does not match user");
    }
    db.run(`UPDATE workspaceInvites SET acceptedAt = ? WHERE id = ?`, [now, inviteId]);
    db.run(
      `INSERT INTO workspaceMembers(workspaceId, userId, role, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(workspaceId, userId) DO UPDATE SET role = excluded.role, updatedAt = excluded.updatedAt`,
      [row.workspaceId, userId, row.role, now, now]
    );
  });
}

export async function revokeInvite(workspaceId, inviteId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `UPDATE workspaceInvites SET revokedAt = ?, updatedAt = ? WHERE id = ? AND workspaceId = ?`,
    [now, now, inviteId, workspaceId],
  );
}
