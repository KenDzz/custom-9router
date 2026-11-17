"use client";

import DailyTokenLimitInput from "./DailyTokenLimitInput";

export default function SplitTokenLimitInputs({ limits, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DailyTokenLimitInput label="Daily input token limit" value={limits.dailyInputTokenLimit}
        onChange={(dailyInputTokenLimit) => onChange({ dailyInputTokenLimit })} />
      <DailyTokenLimitInput label="Daily output token limit" value={limits.dailyOutputTokenLimit}
        onChange={(dailyOutputTokenLimit) => onChange({ dailyOutputTokenLimit })} />
    </div>
  );
}
