import { describe, expect, it } from "vitest";
import {
  formatDailyTokenLimitInput,
  normalizeDailyTokenLimitInput,
  parseDailyTokenLimit,
} from "@/shared/utils/dailyTokenLimit";

describe("daily token limit input", () => {
  it("groups thousands for display while keeping only digits in form state", () => {
    expect(normalizeDailyTokenLimitInput("1,250,000")).toBe("1250000");
    expect(formatDailyTokenLimitInput("1250000")).toBe("1,250,000");
    expect(normalizeDailyTokenLimitInput("000,125")).toBe("125");
    expect(normalizeDailyTokenLimitInput("12.5")).toBeNull();
  });

  it("accepts unlimited and the maximum, but rejects empty or excessive limits", () => {
    expect(parseDailyTokenLimit("0")).toBe(0);
    expect(parseDailyTokenLimit("1000000000000")).toBe(1_000_000_000_000);
    expect(parseDailyTokenLimit("")).toBeNull();
    expect(parseDailyTokenLimit("1000000000001")).toBeNull();
    expect(parseDailyTokenLimit("1.5")).toBeNull();
  });
});
