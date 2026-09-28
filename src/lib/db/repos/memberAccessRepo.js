import { getAdapter } from "../driver.js";
import { WORKSPACE_ROLES } from "../../workspaces/constants.js";

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function getMemberTokenStatus(workspaceId, userId) {
  const db = await getAdapter();
  const membership = db.get(
    `SELECT m.role, m.dailyTokenLimit FROM workspaceMembers m
     JOIN users u ON u.id = m.userId AND u.isActive = 1
     WHERE m.workspaceId = ? AND m.userId = ?`,
    [workspaceId, userId],
  );
  if (!membership) return null;

  const start = startOfLocalDay();
  const reset = nextLocalDay(start);
  const usage = db.get(
    `SELECT
       COUNT(*) AS requests,
       COALESCE(SUM(promptTokens), 0) AS promptTokens,
       COALESCE(SUM(completionTokens), 0) AS completionTokens
     FROM usageHistory
     WHERE workspaceId = ? AND userId = ? AND timestamp >= ? AND timestamp < ?`,
    [workspaceId, userId, start.toISOString(), reset.toISOString()],
  ) || {};

  const limit = membership.role === WORKSPACE_ROLES.OWNER
    ? 0
    : Number(membership.dailyTokenLimit || 0);
  const promptTokens = Number(usage.promptTokens || 0);
  const completionTokens = Number(usage.completionTokens || 0);
  const usedTokens = promptTokens + completionTokens;

  return {
    role: membership.role,
    dailyTokenLimit: limit,
    usedTokens,
    promptTokens,
    completionTokens,
    requests: Number(usage.requests || 0),
    remainingTokens: limit > 0 ? Math.max(0, limit - usedTokens) : null,
    percentage: limit > 0 ? Math.min(100, Math.round((usedTokens / limit) * 1000) / 10) : 0,
    limitReached: limit > 0 && usedTokens >= limit,
    resetsAt: reset.toISOString(),
  };
}

export async function getMemberDashboard(workspaceId, userId) {
  const db = await getAdapter();
  const tokenStatus = await getMemberTokenStatus(workspaceId, userId);
  if (!tokenStatus) return null;

  const today = startOfLocalDay();
  const chartStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const history = db.all(
    `SELECT timestamp, provider, model, promptTokens, completionTokens, status
     FROM usageHistory
     WHERE workspaceId = ? AND userId = ? AND timestamp >= ?
     ORDER BY timestamp ASC, id ASC`,
    [workspaceId, userId, chartStart.toISOString()],
  );
  const recent = [...history].reverse().slice(0, 12).map((row) => ({
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    promptTokens: Number(row.promptTokens || 0),
    completionTokens: Number(row.completionTokens || 0),
    totalTokens: Number(row.promptTokens || 0) + Number(row.completionTokens || 0),
    status: row.status || "ok",
  }));

  const totalsByDay = new Map();
  for (const row of history) {
    const date = new Date(row.timestamp);
    const key = toDateKey(date);
    totalsByDay.set(key, (totalsByDay.get(key) || 0) + Number(row.promptTokens || 0) + Number(row.completionTokens || 0));
  }
  const chart = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - index));
    const key = toDateKey(date);
    return {
      date: key,
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      tokens: totalsByDay.get(key) || 0,
    };
  });

  const keyStats = db.get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END), 0) AS active
     FROM apiKeys WHERE workspaceId = ? AND userId = ?`,
    [workspaceId, userId],
  ) || {};

  return {
    tokenStatus,
    chart,
    recent,
    keys: { total: Number(keyStats.total || 0), active: Number(keyStats.active || 0) },
  };
}
