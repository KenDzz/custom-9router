import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let users;
let workspaces;
let gifts;
let access;
let usage;
let requestContext;
let driver;
let owner;
let workspace;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-member-gifts-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  users = await import("@/lib/db/repos/usersRepo.js");
  workspaces = await import("@/lib/db/repos/workspacesRepo.js");
  gifts = await import("@/lib/db/repos/memberGiftsRepo.js");
  access = await import("@/lib/db/repos/memberAccessRepo.js");
  usage = await import("@/lib/db/repos/usageRepo.js");
  requestContext = await import("@/lib/workspaces/requestContext.js");
  driver = await import("@/lib/db/driver.js");
  await db.initDb();
  owner = await users.createUser({ username: "gift-owner", email: "gift-owner@example.com" });
  workspace = await workspaces.createWorkspace("Gifts", owner.id);
});

afterAll(async () => {
  await db?.closeDb?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

let sequence = 0;
async function limitedMember(limit = 100) {
  const number = ++sequence;
  const user = await users.createUser({ username: `gift-member-${number}`, email: `gift-${number}@example.com` });
  await workspaces.addMember(workspace.id, user.id, "member", { dailyTokenLimit: limit });
  return user;
}

function activeWindow() {
  return {
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

async function record(user, tokens) {
  return requestContext.runWithWorkspace({ workspaceId: workspace.id, userId: user.id }, () =>
    usage.saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: "test",
      model: `gift-test-${sequence}-${tokens}`,
      tokens: { prompt_tokens: tokens, completion_tokens: 0 },
    }));
}

describe("stackable member gifts", () => {
  it("spends the daily limit first, then active token gifts by earliest expiry", async () => {
    const member = await limitedMember();
    const window = activeWindow();
    const early = await gifts.createMemberGift(workspace.id, member.id, {
      type: "tokens", amount: 15, startsAt: window.startsAt,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }, owner.id);
    const later = await gifts.createMemberGift(workspace.id, member.id, {
      type: "tokens", amount: 50, ...window,
    }, owner.id);

    await record(member, 120);
    expect(await access.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      usedTokens: 120,
      tokenGiftRemaining: 45,
      remainingTokens: 45,
      limitReached: false,
    });
    const grants = await gifts.listMemberGifts(workspace.id, member.id);
    expect(grants.find((gift) => gift.id === early.id).usedAmount).toBe(15);
    expect(grants.find((gift) => gift.id === later.id).usedAmount).toBe(5);

    await record(member, 45);
    expect(await access.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      tokenGiftRemaining: 0,
      remainingTokens: 0,
      limitReached: true,
    });
  });

  it("keeps future gifts unavailable until their start timestamp", async () => {
    const member = await limitedMember(10);
    await gifts.createMemberGift(workspace.id, member.id, {
      type: "tokens", amount: 30,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
    }, owner.id);
    await record(member, 10);
    expect(await access.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      tokenGiftRemaining: 0,
      limitReached: true,
    });
  });

  it("applies start and expiry boundaries to the second", async () => {
    const member = await limitedMember();
    const startTime = Math.floor((Date.now() + 86_400_000) / 1000) * 1000;
    const start = new Date(startTime).toISOString();
    const end = new Date(startTime + 2_000).toISOString();
    const gift = await gifts.createMemberGift(workspace.id, member.id, {
      type: "tokens", amount: 20, startsAt: start, endsAt: end,
    }, owner.id);
    expect(gift.startsAt).toBe(start);
    expect(gift.endsAt).toBe(end);
    const adapter = await driver.getAdapter();
    expect(gifts.getActiveGiftBalances(adapter, workspace.id, member.id, new Date(startTime - 1).toISOString()).tokens).toBe(0);
    expect(gifts.getActiveGiftBalances(adapter, workspace.id, member.id, start).tokens).toBe(20);
    expect(gifts.getActiveGiftBalances(adapter, workspace.id, member.id, new Date(startTime + 1_999).toISOString()).tokens).toBe(20);
    expect(gifts.getActiveGiftBalances(adapter, workspace.id, member.id, end).tokens).toBe(0);
  });

  it("allows a direct owner reset without deleting request history or restoring spent gifts", async () => {
    const member = await limitedMember(10);
    await gifts.createMemberGift(workspace.id, member.id, { type: "tokens", amount: 10, ...activeWindow() }, owner.id);
    await record(member, 15);
    expect((await access.getMemberTokenStatus(workspace.id, member.id)).tokenGiftRemaining).toBe(5);

    await gifts.resetMemberQuotaUsage(workspace.id, member.id);
    const status = await access.getMemberTokenStatus(workspace.id, member.id);
    expect(status.usedTokens).toBe(0);
    expect(status.actualUsedToday).toBe(15);
    expect(status.remainingTokens).toBe(15);
    expect(status.tokenGiftRemaining).toBe(5);
    expect(status.requests).toBe(1);
  });

  it("stacks reset passes and spends one per member redemption", async () => {
    const member = await limitedMember(10);
    await gifts.createMemberGift(workspace.id, member.id, { type: "reset", amount: 1, ...activeWindow() }, owner.id);
    await gifts.createMemberGift(workspace.id, member.id, { type: "reset", amount: 2, ...activeWindow() }, owner.id);
    expect((await access.getMemberTokenStatus(workspace.id, member.id)).resetGiftsAvailable).toBe(3);

    await expect(gifts.redeemMemberResetGift(workspace.id, member.id)).rejects.toThrow("No usage to reset");
    await record(member, 10);
    await gifts.redeemMemberResetGift(workspace.id, member.id);
    expect(await access.getMemberTokenStatus(workspace.id, member.id)).toMatchObject({
      usedTokens: 0,
      actualUsedToday: 10,
      resetGiftsAvailable: 2,
      limitReached: false,
    });
    await record(member, 5);
    await gifts.redeemMemberResetGift(workspace.id, member.id);
    expect((await access.getMemberTokenStatus(workspace.id, member.id)).resetGiftsAvailable).toBe(1);
  });

  it("does not spend a reset pass for an unlimited member", async () => {
    const member = await limitedMember(0);
    await gifts.createMemberGift(workspace.id, member.id, { type: "reset", amount: 1, ...activeWindow() }, owner.id);
    await record(member, 5);
    await expect(gifts.redeemMemberResetGift(workspace.id, member.id)).rejects.toThrow("No daily limit");
    expect((await access.getMemberTokenStatus(workspace.id, member.id)).resetGiftsAvailable).toBe(1);
  });

  it("rejects invalid gift windows and amounts", async () => {
    const member = await limitedMember();
    const window = activeWindow();
    await expect(gifts.createMemberGift(workspace.id, member.id, { type: "tokens", amount: 0, ...window }, owner.id))
      .rejects.toThrow("Gift amount");
    await expect(gifts.createMemberGift(workspace.id, member.id, {
      type: "reset", amount: 1, startsAt: window.endsAt, endsAt: window.startsAt,
    }, owner.id)).rejects.toThrow("End time");
    await expect(gifts.createMemberGift(workspace.id, member.id, {
      type: "tokens", amount: 1, startsAt: "2026-01-01T00:00:00", endsAt: window.endsAt,
    }, owner.id)).rejects.toThrow("time zone");
  });
});
