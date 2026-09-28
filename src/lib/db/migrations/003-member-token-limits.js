import { WORKSPACE_ROLES } from "../../workspaces/constants.js";

function hasColumn(db, tableName, columnName) {
  return db.all(`PRAGMA table_info(${tableName})`).some((column) => column.name === columnName);
}

const migration = {
  version: 3,
  name: "member-token-limits",
  up(db) {
    if (!hasColumn(db, "workspaceMembers", "dailyTokenLimit")) {
      db.exec("ALTER TABLE workspaceMembers ADD COLUMN dailyTokenLimit INTEGER NOT NULL DEFAULT 0");
    }
    if (!hasColumn(db, "apiKeys", "userId")) {
      db.exec("ALTER TABLE apiKeys ADD COLUMN userId TEXT");
    }
    if (!hasColumn(db, "usageHistory", "userId")) {
      db.exec("ALTER TABLE usageHistory ADD COLUMN userId TEXT");
    }

    // Existing keys belonged to the workspace before per-member ownership
    // existed. Attribute them to the oldest owner so upgrades remain usable.
    db.run(
      `UPDATE apiKeys
       SET userId = (
         SELECT member.userId
         FROM workspaceMembers member
         WHERE member.workspaceId = apiKeys.workspaceId AND member.role = ?
         ORDER BY member.createdAt ASC
         LIMIT 1
       )
       WHERE userId IS NULL`,
      [WORKSPACE_ROLES.OWNER],
    );

    // Preserve historical attribution where the raw API key is still known.
    db.run(
      `UPDATE usageHistory
       SET userId = (
         SELECT apiKeys.userId FROM apiKeys
         WHERE apiKeys.workspaceId = usageHistory.workspaceId
           AND apiKeys.key = usageHistory.apiKey
         LIMIT 1
       )
       WHERE userId IS NULL AND apiKey IS NOT NULL`,
    );

    db.exec("CREATE INDEX IF NOT EXISTS idx_ak_workspace_user ON apiKeys(workspaceId, userId, createdAt)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_uh_workspace_user_ts ON usageHistory(workspaceId, userId, timestamp DESC)");
  },
};

export default migration;
