const migration = {
  version: 4,
  name: "invite-token-limits",
  up(db) {
    const columns = db.all("PRAGMA table_info(workspaceInvites)");
    if (!columns.some((column) => column.name === "dailyTokenLimit")) {
      db.exec("ALTER TABLE workspaceInvites ADD COLUMN dailyTokenLimit INTEGER");
    }
  },
};

export default migration;
