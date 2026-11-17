import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { computeQuotaTokens, usdToStandardTokens } from "@/lib/workspaces/standardTokens.js";
import { calculateCostFromTokens } from "open-sse/providers/pricing.js";
import { canonicalizeUsage } from "open-sse/utils/usageTracking.js";

// Sonnet-like price ($/1M): cache read a tenth of input, cache write 1.25x.
const SONNET = { input: 2, output: 10, cached: 0.2, cache_creation: 2.5 };
const OPUS = { input: 5, output: 25, cached: 0.5, cache_creation: 6.25 };

// A typical Claude Code turn: tiny fresh input, large cache read. Stored in the
// canonical shape the gateway saves (prompt_tokens includes the cache).
const CLAUDE_TURN = canonicalizeUsage({
  input_tokens: 1000,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 2000,
  output_tokens: 500,
});
const CLAUDE_TURN_PROMPT = 103_000;
const CLAUDE_TURN_RAW = 103_500;
// input  = 1000*2 + 100000*0.2 + 2000*2.5 = $0.027 → 13,500
// output = 500*10                          = $0.005 →  2,500
const CLAUDE_TURN_QUOTA = { input: 13_500, output: 2_500 };

describe("standard token conversion", () => {
  it("maps $2 to one million standard tokens and rounds partial tokens up", () => {
    expect(usdToStandardTokens(2)).toBe(1_000_000);
    expect(usdToStandardTokens(0)).toBe(0);
    expect(usdToStandardTokens(-1)).toBe(0);
    expect(usdToStandardTokens(Number.NaN)).toBe(0);
    expect(usdToStandardTokens(0.000_000_1)).toBe(1);
    // Float noise must not add a token to an exact amount.
    expect(usdToStandardTokens(3 * 0.000002)).toBe(3);
  });

  it("charges cache reads at their own price instead of raw tokens", () => {
    expect(CLAUDE_TURN.prompt_tokens).toBe(CLAUDE_TURN_PROMPT);
    expect(computeQuotaTokens(CLAUDE_TURN, SONNET)).toEqual({ ...CLAUDE_TURN_QUOTA, priced: true });
  });

  it("charges an expensive model more than a cheaper one for the same tokens", () => {
    const tokens = { prompt_tokens: 10_000, completion_tokens: 2_000 };
    const sonnet = computeQuotaTokens(tokens, SONNET);
    const opus = computeQuotaTokens(tokens, OPUS);
    expect(sonnet).toEqual({ input: 10_000, output: 10_000, priced: true });
    expect(opus).toEqual({ input: 25_000, output: 25_000, priced: true });
  });

  it("charges nothing for a model priced at zero", () => {
    const zero = { input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0 };
    expect(computeQuotaTokens({ prompt_tokens: 50_000, completion_tokens: 9_000 }, zero))
      .toEqual({ input: 0, output: 0, priced: true });
  });

  it("falls back to raw tokens for a model without a price", () => {
    expect(computeQuotaTokens({ prompt_tokens: 700, completion_tokens: 30 }, null))
      .toEqual({ input: 700, output: 30, priced: false });
    expect(computeQuotaTokens({ input_tokens: 70, output_tokens: 3 }, { input: "n/a" }))
      .toEqual({ input: 70, output: 3, priced: false });
  });

  it("splits exactly the cost the usage row records", () => {
    const samples = [
      [CLAUDE_TURN, SONNET],
      [CLAUDE_TURN, OPUS],
      [{ prompt_tokens: 12_345, cached_tokens: 10_000, completion_tokens: 777, reasoning_tokens: 300 }, { input: 1.25, output: 10, cached: 0.125 }],
      [{ prompt_tokens: 0, completion_tokens: 1000, reasoning_tokens: 400 }, { input: 2, output: 10 }],
    ];
    for (const [tokens, pricing] of samples) {
      const quota = computeQuotaTokens(tokens, pricing);
      const whole = usdToStandardTokens(calculateCostFromTokens(tokens, pricing));
      // Each side rounds up on its own, so the sum may exceed the whole by one.
      expect(quota.input + quota.output - whole).toBeGreaterThanOrEqual(0);
      expect(quota.input + quota.output - whole).toBeLessThanOrEqual(1);
    }
    // Reasoning follows the cost formula: priced on top of the output count.
    expect(computeQuotaTokens({ prompt_tokens: 0, completion_tokens: 1000, reasoning_tokens: 400 }, { input: 2, output: 10 }))
      .toEqual({ input: 0, output: 7000, priced: true });
  });
});

describe("member quota in standard tokens", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;
  let users;
  let workspaces;
  let gifts;
  let access;
  let usage;
  let pricing;
  let requestContext;
  let driver;
  let migration007;
  let workspace;
  let sequence = 0;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-standard-tokens-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    users = await import("@/lib/db/repos/usersRepo.js");
    workspaces = await import("@/lib/db/repos/workspacesRepo.js");
    gifts = await import("@/lib/db/repos/memberGiftsRepo.js");
    access = await import("@/lib/db/repos/memberAccessRepo.js");
    usage = await import("@/lib/db/repos/usageRepo.js");
    pricing = await import("@/lib/db/repos/pricingRepo.js");
    requestContext = await import("@/lib/workspaces/requestContext.js");
    driver = await import("@/lib/db/driver.js");
    migration007 = (await import("@/lib/db/migrations/007-quota-standard-tokens.js")).default;
    await db.initDb();
    const owner = await users.createUser({ username: "std-owner", email: "std-owner@example.com" });
    workspace = await workspaces.createWorkspace("Standard tokens", owner.id);
    await pricing.updatePricing({ "quota-test": { "std-sonnet": SONNET } });
  });

  afterAll(async () => {
    await db?.closeDb?.();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function member(limits) {
    const number = ++sequence;
    const user = await users.createUser({ username: `std-member-${number}`, email: `std-${number}@example.com` });
    await workspaces.addMember(workspace.id, user.id, "member", limits);
    return user;
  }

  async function record(user, tokens, model = "std-sonnet") {
    return requestContext.runWithWorkspace({ workspaceId: workspace.id, userId: user.id }, () =>
      usage.saveRequestUsage({
        timestamp: new Date().toISOString(),
        provider: "quota-test",
        model,
        tokens,
      }));
  }

  async function rows(user) {
    const adapter = await driver.getAdapter();
    return adapter.all(
      "SELECT promptTokens, completionTokens, quotaInputTokens, quotaOutputTokens, cost FROM usageHistory WHERE userId = ? ORDER BY id",
      [user.id],
    );
  }

  it("stores the standard-token charge and cost on each usage row", async () => {
    const user = await member({ dailyTokenLimit: 20_000 });
    await record(user, CLAUDE_TURN);
    const [row] = await rows(user);
    expect(row).toMatchObject({
      promptTokens: CLAUDE_TURN_PROMPT,
      completionTokens: 500,
      quotaInputTokens: CLAUDE_TURN_QUOTA.input,
      quotaOutputTokens: CLAUDE_TURN_QUOTA.output,
    });
    expect(row.cost).toBeCloseTo(0.032, 10);
  });

  it("counts the daily limit in standard tokens and keeps raw totals for display", async () => {
    const user = await member({ dailyTokenLimit: 20_000 });
    await record(user, CLAUDE_TURN);
    expect(await access.getMemberTokenStatus(workspace.id, user.id)).toMatchObject({
      usedTokens: 16_000,
      actualUsedToday: CLAUDE_TURN_RAW,
      remainingTokens: 4_000,
      limitReached: false,
    });
    await record(user, CLAUDE_TURN);
    expect(await access.getMemberTokenStatus(workspace.id, user.id)).toMatchObject({
      usedTokens: 32_000,
      remainingTokens: 0,
      limitReached: true,
    });

    // The activity chart and recent list keep showing raw tokens.
    const dashboard = await access.getMemberDashboard(workspace.id, user.id);
    expect(dashboard.recent[0].totalTokens).toBe(CLAUDE_TURN_RAW);
    expect(dashboard.chart.at(-1).tokens).toBe(2 * CLAUDE_TURN_RAW);
  });

  it("applies split limits to each side of the standard-token charge", async () => {
    const user = await member({ dailyInputTokenLimit: 13_500, dailyOutputTokenLimit: 10_000 });
    await record(user, CLAUDE_TURN);
    const status = await access.getMemberTokenStatus(workspace.id, user.id);
    expect(status.quotas).toEqual([
      { type: "input", limit: 13_500, used: 13_500, remaining: 0 },
      { type: "output", limit: 10_000, used: 2_500, remaining: 7_500 },
    ]);
    expect(status.exhaustedQuotaTypes).toEqual(["input"]);
  });

  it("does not charge free models and charges unpriced models raw", async () => {
    const user = await member({ dailyTokenLimit: 1_000_000 });
    await record(user, { prompt_tokens: 90_000, completion_tokens: 9_000 }, "cline-free/any-model");
    await record(user, { prompt_tokens: 700, completion_tokens: 30 }, "std-unpriced-model-xyz");
    const [free, unpriced] = await rows(user);
    expect(free).toMatchObject({ quotaInputTokens: 0, quotaOutputTokens: 0, cost: 0 });
    expect(unpriced).toMatchObject({ quotaInputTokens: 700, quotaOutputTokens: 30, cost: 0 });
    expect(await access.getMemberTokenStatus(workspace.id, user.id)).toMatchObject({
      usedTokens: 730,
      actualUsedToday: 99_730,
      requests: 2,
    });
  });

  it("spends token gifts in standard tokens after the base allowance", async () => {
    const user = await member({ dailyTokenLimit: 10_000 });
    const owner = await users.createUser({ username: `std-gifter-${++sequence}`, email: `std-gifter-${sequence}@example.com` });
    await gifts.createMemberGift(workspace.id, user.id, {
      type: "tokens",
      amount: 10_000,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    }, owner.id);
    await record(user, CLAUDE_TURN);
    expect(await access.getMemberTokenStatus(workspace.id, user.id)).toMatchObject({
      usedTokens: 16_000,
      tokenGiftRemaining: 4_000,
      limitReached: false,
    });
  });

  it("backfills recent member rows and leaves old or ownerless rows alone", async () => {
    const user = await member({ dailyTokenLimit: 0 });
    const adapter = await driver.getAdapter();
    const insert = (userId, timestamp, tokens) => adapter.run(
      `INSERT INTO usageHistory(workspaceId, userId, timestamp, provider, model, promptTokens, completionTokens, tokens)
       VALUES(?, ?, ?, 'quota-test', 'std-sonnet', ?, ?, ?)`,
      [workspace.id, userId, timestamp, tokens.prompt_tokens || 0, tokens.completion_tokens || 0, JSON.stringify(tokens)],
    );
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    insert(user.id, now, CLAUDE_TURN);
    insert(user.id, old, CLAUDE_TURN);
    insert(null, now, CLAUDE_TURN);

    adapter.transaction(() => migration007.up(adapter));

    const backfilled = adapter.all(
      "SELECT userId, timestamp, quotaInputTokens, quotaOutputTokens FROM usageHistory WHERE model = 'std-sonnet' AND (userId = ? OR userId IS NULL) AND cost = 0",
      [user.id],
    );
    expect(backfilled).toEqual(expect.arrayContaining([
      { userId: user.id, timestamp: now, quotaInputTokens: CLAUDE_TURN_QUOTA.input, quotaOutputTokens: CLAUDE_TURN_QUOTA.output },
      { userId: user.id, timestamp: old, quotaInputTokens: null, quotaOutputTokens: null },
      { userId: null, timestamp: now, quotaInputTokens: null, quotaOutputTokens: null },
    ]));
    // Re-running is a no-op for rows that already carry a charge.
    expect(() => adapter.transaction(() => migration007.up(adapter))).not.toThrow();
  });
});
