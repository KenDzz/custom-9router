import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";
import { MIGRATED_ADMIN_USER_ID } from "../../workspaces/constants.js";

// Identity fields are account-wide; membership, role and quota are scoped to
// this workspace. Commit all validated fields together, including password.
export async function updateMemberProfile(workspaceId, userId, data, actorUserId = null) {
  const db = await getAdapter();
  const passwordHash = data.newPassword ? await bcrypt.hash(data.newPassword, 10) : null;
  const now = new Date().toISOString();
  db.transaction(() => {
    const member = db.get("SELECT * FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [workspaceId, userId]);
    const user = db.get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!member || !user) throw new Error("Member not found");
    const changesIdentity = passwordHash || ["username", "displayName", "email"]
      .some((field) => data[field] !== undefined && data[field] !== user[field]);
    // Workspace administration must not grant access to privileged accounts.
    // Quota and role edits remain scoped to this workspace.
    if (changesIdentity && actorUserId !== userId && db.get(
      "SELECT 1 FROM workspaceMembers WHERE userId = ? AND role IN ('owner', 'admin') AND (workspaceId != ? OR ? != ?)",
      [userId, workspaceId, actorUserId, MIGRATED_ADMIN_USER_ID],
    )) throw new Error("Cannot change the account of a protected owner or admin");
    const role = data.role ?? member.role;
    if (member.role === "owner" && role !== "owner") {
      const owners = db.get("SELECT COUNT(*) AS total FROM workspaceMembers WHERE workspaceId = ? AND role = 'owner'", [workspaceId]);
      if (owners.total <= 1) throw new Error("Cannot demote the last owner");
    }
    db.run(
      `UPDATE users SET username = ?, displayName = ?, email = ?, passwordHash = ?, updatedAt = ? WHERE id = ?`,
      [data.username ?? user.username, data.displayName !== undefined ? data.displayName : user.displayName,
        data.email !== undefined ? data.email : user.email, passwordHash ?? user.passwordHash, now, userId],
    );
    db.run(
      "UPDATE workspaceMembers SET role = ?, dailyTokenLimit = ?, dailyInputTokenLimit = ?, dailyOutputTokenLimit = ?, updatedAt = ? WHERE workspaceId = ? AND userId = ?",
      [role, role === "owner" ? 0 : data.dailyTokenLimit ?? member.dailyTokenLimit,
        role === "owner" ? null : data.dailyInputTokenLimit ?? member.dailyInputTokenLimit,
        role === "owner" ? null : data.dailyOutputTokenLimit ?? member.dailyOutputTokenLimit, now, workspaceId, userId],
    );
  });
}
