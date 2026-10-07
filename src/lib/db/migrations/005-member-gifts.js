import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 5,
  name: "member-gifts",
  up(db) {
    const columns = db.all("PRAGMA table_info(workspaceMembers)");
    if (!columns.some((column) => column.name === "quotaResetAt")) {
      db.exec("ALTER TABLE workspaceMembers ADD COLUMN quotaResetAt TEXT");
    }
    if (!columns.some((column) => column.name === "quotaResetHistoryId")) {
      db.exec("ALTER TABLE workspaceMembers ADD COLUMN quotaResetHistoryId INTEGER NOT NULL DEFAULT 0");
    }
    db.exec(buildCreateTableSql("workspaceMemberGifts", TABLES.workspaceMemberGifts));
    for (const index of TABLES.workspaceMemberGifts.indexes) db.exec(index);
  },
};

export default migration;
