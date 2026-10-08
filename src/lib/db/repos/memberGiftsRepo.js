import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

export const MAX_GIFT_TOKENS = 1_000_000_000_000;
export const MAX_RESET_PASSES = 1_000;

function toGift(row, now = new Date().toISOString()) {
  const remainingAmount = Math.max(0, Number(row.amount) - Number(row.usedAmount));
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    type: row.type,
    amount: Number(row.amount),
    usedAmount: Number(row.usedAmount),
    remainingAmount,
    status: now < row.startsAt ? "scheduled" : now >= row.endsAt ? "expired" : remainingAmount ? "active" : "used",
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdAt: row.createdAt,
  };
}

function parseDateTime(value, label) {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} must include a time zone`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} is invalid`);
  return new Date(time).toISOString();
}

export async function createMemberGift(workspaceId, userId, data, actorUserId) {
  const type = data?.type;
  const amount = data?.amount;
  if (type !== "tokens" && type !== "reset") throw new Error("Invalid gift type");
  const max = type === "tokens" ? MAX_GIFT_TOKENS : MAX_RESET_PASSES;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > max) {
    throw new Error(`Gift amount must be an integer from 1 to ${max.toLocaleString("en-US")}`);
  }
  const startsAt = parseDateTime(data.startsAt, "Start time");
  const endsAt = parseDateTime(data.endsAt, "End time");
  if (endsAt <= startsAt || endsAt <= new Date().toISOString()) {
    throw new Error("End time must be after start time and in the future");
  }

  const db = await getAdapter();
  const now = new Date().toISOString();
  const gift = {
    id: uuidv4(), workspaceId, userId, type, amount, usedAmount: 0,
    startsAt, endsAt, createdByUserId: actorUserId, createdAt: now,
  };
  db.transaction(() => {
    const member = db.get("SELECT role FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [workspaceId, userId]);
    if (!member) throw new Error("Member not found");
    if (member.role === "owner") throw new Error("Owners have unlimited usage and cannot receive gifts");
    db.run(
      `INSERT INTO workspaceMemberGifts(id, workspaceId, userId, type, amount, usedAmount, startsAt, endsAt, createdByUserId, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gift.id, workspaceId, userId, type, amount, 0, startsAt, endsAt, actorUserId, now],
    );
  });
  return toGift(gift);
}

export async function listMemberGifts(workspaceId, userId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  return db.all(
    `SELECT * FROM workspaceMemberGifts WHERE workspaceId = ? AND userId = ?
     ORDER BY createdAt DESC, id DESC LIMIT 100`,
    [workspaceId, userId],
  ).map((row) => toGift(row, now));
}

export function getActiveGiftBalances(db, workspaceId, userId, atIso = new Date().toISOString()) {
  const rows = db.all(
    `SELECT type, COALESCE(SUM(amount - usedAmount), 0) AS remaining
     FROM workspaceMemberGifts
     WHERE workspaceId = ? AND userId = ? AND startsAt <= ? AND endsAt > ? AND usedAmount < amount
     GROUP BY type`,
    [workspaceId, userId, atIso, atIso],
  );
  const balances = { tokens: 0, reset: 0 };
  for (const row of rows) balances[row.type] = Number(row.remaining);
  return balances;
}

export async function resetMemberQuotaUsage(workspaceId, userId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    const lastId = db.get("SELECT COALESCE(MAX(id), 0) AS id FROM usageHistory WHERE workspaceId = ? AND userId = ?", [workspaceId, userId]);
    const result = db.run(
      `UPDATE workspaceMembers SET quotaResetAt = ?, quotaResetHistoryId = ?, updatedAt = ?
       WHERE workspaceId = ? AND userId = ? AND role != 'owner'`,
      [now, Number(lastId?.id || 0), now, workspaceId, userId],
    );
    if (!result?.changes) throw new Error("Member not found or is an owner");
  });
  return now;
}

export async function redeemMemberResetGift(workspaceId, userId) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  return db.transaction(() => {
    const member = db.get("SELECT role, dailyTokenLimit, quotaResetAt, quotaResetHistoryId FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [workspaceId, userId]);
    if (!member || member.role === "owner") throw new Error("Member not found or is an owner");
    if (Number(member.dailyTokenLimit || 0) <= 0) throw new Error("No daily limit to reset");
    const date = new Date();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const quotaStart = member.quotaResetAt && member.quotaResetAt > dayStart ? member.quotaResetAt : dayStart;
    const used = db.get(
      `SELECT COALESCE(SUM(promptTokens + completionTokens), 0) AS tokens
       FROM usageHistory WHERE workspaceId = ? AND userId = ? AND timestamp >= ? AND timestamp <= ? AND id > ?`,
      [workspaceId, userId, quotaStart, now, Number(member.quotaResetHistoryId || 0)],
    );
    if (!Number(used?.tokens || 0)) throw new Error("No usage to reset today");
    const gift = db.get(
      `SELECT id FROM workspaceMemberGifts
       WHERE workspaceId = ? AND userId = ? AND type = 'reset'
         AND startsAt <= ? AND endsAt > ? AND usedAmount < amount
       ORDER BY endsAt ASC, startsAt ASC, createdAt ASC LIMIT 1`,
      [workspaceId, userId, now, now],
    );
    if (!gift) throw new Error("No active reset gifts remaining");
    db.run("UPDATE workspaceMemberGifts SET usedAmount = usedAmount + 1 WHERE id = ?", [gift.id]);
    const lastId = db.get("SELECT COALESCE(MAX(id), 0) AS id FROM usageHistory WHERE workspaceId = ? AND userId = ?", [workspaceId, userId]);
    db.run(
      "UPDATE workspaceMembers SET quotaResetAt = ?, quotaResetHistoryId = ?, updatedAt = ? WHERE workspaceId = ? AND userId = ?",
      [now, Number(lastId?.id || 0), now, workspaceId, userId],
    );
    return now;
  });
}

// Called inside the same transaction as the usageHistory insert. Daily tokens
// are spent first; excess uses active one-time gifts, earliest expiry first.
export function chargeTokenGiftsForUsage(db, workspaceId, userId, timestamp, tokenCount) {
  if (!userId || !Number.isFinite(tokenCount) || tokenCount <= 0) return;
  const member = db.get(
    "SELECT role, dailyTokenLimit, quotaResetAt, quotaResetHistoryId FROM workspaceMembers WHERE workspaceId = ? AND userId = ?",
    [workspaceId, userId],
  );
  const limit = Number(member?.dailyTokenLimit || 0);
  if (!member || member.role === "owner" || limit <= 0) return;
  if (member.quotaResetAt && timestamp < member.quotaResetAt) return;

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).toISOString();
  const quotaStart = member.quotaResetAt && member.quotaResetAt > dayStart ? member.quotaResetAt : dayStart;
  // Completion order may differ from usage timestamps. Spend the base allowance
  // against every already-committed row for this day, inside the write transaction.
  const prior = db.get(
    `SELECT COALESCE(SUM(promptTokens + completionTokens), 0) AS used
     FROM usageHistory WHERE workspaceId = ? AND userId = ? AND timestamp >= ? AND timestamp < ? AND id > ?`,
    [workspaceId, userId, quotaStart, dayEnd, Number(member.quotaResetHistoryId || 0)],
  );
  const baseRemaining = Math.max(0, limit - Number(prior?.used || 0));
  let giftCharge = Math.max(0, Math.floor(tokenCount) - baseRemaining);
  if (!giftCharge) return;

  const gifts = db.all(
    `SELECT id, amount, usedAmount FROM workspaceMemberGifts
     WHERE workspaceId = ? AND userId = ? AND type = 'tokens'
       AND startsAt <= ? AND endsAt > ? AND usedAmount < amount
     ORDER BY endsAt ASC, startsAt ASC, createdAt ASC`,
    [workspaceId, userId, timestamp, timestamp],
  );
  for (const gift of gifts) {
    const spent = Math.min(giftCharge, Number(gift.amount) - Number(gift.usedAmount));
    if (spent <= 0) continue;
    db.run("UPDATE workspaceMemberGifts SET usedAmount = usedAmount + ? WHERE id = ?", [spent, gift.id]);
    giftCharge -= spent;
    if (!giftCharge) break;
  }
}
