import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

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
    // Owning one workspace must not grant account takeover of an owner in
    // another workspace. Quota/role edits here remain workspace-local.
    if (changesIdentity && actorUserId !== userId && db.get(
      "SELECT 1 FROM workspaceMembers WHERE userId = ? AND role = 'owner' AND workspaceId != ?",
      [userId, workspaceId],
    )) throw new Error("Cannot change the account of an owner in another workspace");
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
      "UPDATE workspaceMembers SET role = ?, dailyTokenLimit = ?, updatedAt = ? WHERE workspaceId = ? AND userId = ?",
      [role, role === "owner" ? 0 : data.dailyTokenLimit ?? member.dailyTokenLimit, now, workspaceId, userId],
    );
  });
}
