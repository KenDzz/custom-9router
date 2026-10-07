"use client";

import Input from "../Input";
import {
  formatDailyTokenLimitInput,
  normalizeDailyTokenLimitInput,
  parseDailyTokenLimit,
} from "@/shared/utils/dailyTokenLimit";

export default function DailyTokenLimitInput({ value, onChange, disabled = false }) {
  const invalid = !disabled && parseDailyTokenLimit(value) === null;
  return (
    <Input
      type="text"
      inputMode="numeric"
      label="Daily token limit"
      aria-label="Daily token limit"
      value={formatDailyTokenLimitInput(value)}
      onChange={(event) => {
        const digits = normalizeDailyTokenLimitInput(event.target.value);
        if (digits !== null) onChange(digits);
      }}
      disabled={disabled}
      maxLength={17}
      error={invalid ? "Enter a whole number from 0 to 1,000,000,000,000." : undefined}
      hint={disabled ? "Owners always have unlimited usage." : "0 = unlimited · Commas separate thousands."}
    />
  );
}
