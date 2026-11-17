export default {
  version: 6,
  name: "split-token-limits",
  up(db) {
    for (const table of ["workspaceMembers", "workspaceInvites"]) {
      const columns = db.all(`PRAGMA table_info(${table})`);
      for (const field of ["dailyInputTokenLimit", "dailyOutputTokenLimit"]) {
        if (!columns.some(({ name }) => name === field)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${field} INTEGER`);
      }
    }
  },
};
