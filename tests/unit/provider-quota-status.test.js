import { describe, expect, it } from "vitest";
import { nextQuotaReset, quotaDays, quotaSeverity, recordQuotaSnapshot, remainingQuota } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/statusHistory";

describe("provider quota status", () => {
  it("distinguishes unknown, low, and exhausted without rounding small balances to zero", () => {
    expect(quotaSeverity([{ used: 0, total: 0, message: "Unavailable" }])).toBe(0);
    expect(quotaSeverity([{ unlimited: true }])).toBe(1);
    expect(remainingQuota({ percentage: 99.5, percentageIsUsed: true })).toBe(0.5);
    expect(quotaSeverity([{ percentage: 99.5, percentageIsUsed: true }])).toBe(2);
    expect(quotaSeverity([{ remaining: 75 }, { used: 100, total: 100 }])).toBe(3);
  });

  it("keeps the worst observation per account, with no backfill and a 30-day window", () => {
    const now = new Date(2026, 10, 17, 12);
    const day = quotaDays(now).at(-1).key;
    const original = { "2026-01-01": { a: 2 } };
    const low = recordQuotaSnapshot(original, "a", 2, now);
    expect(low).toEqual({ [day]: { a: 2 } });
    expect(recordQuotaSnapshot(low, "a", 1, now)).toBe(low);
    expect(recordQuotaSnapshot(low, "b", 3, now)).toEqual({ [day]: { a: 2, b: 3 } });
    expect(quotaDays(now)).toHaveLength(30);
  });

  it("chooses the earliest future reset and skips one-time expiries", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    const resetAt = "2026-11-18T12:00:00Z";
    expect(nextQuotaReset([
      { resetAt: "2026-11-17T11:00:00Z" },
      { resetAt: "2026-11-17T13:00:00Z", recurring: false },
      { resetAt: "invalid" }, { resetAt }, { resetAt: "2026-11-19T12:00:00Z" },
    ], now)).toBe(Date.parse(resetAt));
  });
});
