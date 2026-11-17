"use client";

import Input from "../Input";
import {
  formatDailyTokenLimitInput,
  normalizeDailyTokenLimitInput,
  parseDailyTokenLimit,
} from "@/shared/utils/dailyTokenLimit";

export default function DailyTokenLimitInput({ value, onChange, disabled = false, label = "Daily token limit" }) {
  const invalid = !disabled && parseDailyTokenLimit(value) === null;
  return (
    <Input
      type="text"
      inputMode="numeric"
      label={label}
      aria-label={label}
      value={formatDailyTokenLimitInput(value)}
      onChange={(event) => {
        const digits = normalizeDailyTokenLimitInput(event.target.value);
        if (digits !== null) onChange(digits);
      }}
      disabled={disabled}
      maxLength={17}
      error={invalid ? "Enter a whole number from 0 to 1,000,000,000,000." : undefined}
      hint={disabled ? "Owners always have unlimited usage." : "0 = unlimited · Standard tokens (1M = $2 of model cost)."}
    />
  );
}
