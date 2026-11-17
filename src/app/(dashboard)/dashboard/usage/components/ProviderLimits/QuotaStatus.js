"use client";

import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getConnectionLabel } from "./utils";
import { nextQuotaReset, quotaDays, quotaSeverity, remainingQuota } from "./statusHistory";

const STATES = [
  ["No data", "bg-surface-3"],
  ["Available", "bg-emerald-500"],
  ["Low quota", "bg-amber-400"],
  ["Exhausted", "bg-red-500"],
];

const formatDate = (value) => new Date(value).toLocaleString(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const formatPercent = (value) => value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;

export default function QuotaStatus({ connections, quotaData, errors, loading, history, lastUpdated }) {
  const days = quotaDays();
  const groups = new Map();
  const available = new Map();
  for (const account of connections) {
    if (!groups.has(account.provider)) groups.set(account.provider, []);
    groups.get(account.provider).push(account);
    available.set(account.id, account.isActive === false || errors[account.id] ? []
      : (quotaData[account.id]?.quotas || []).filter((quota) => !quota.message));
  }
  const measured = connections.filter(({ isActive }) => isActive !== false)
    .map(({ id }) => quotaSeverity(available.get(id)));
  const worst = Math.max(0, ...measured);
  const headline = !measured.length ? "No active accounts on this page"
    : !worst ? "No quota data available yet"
      : worst === 3 ? "Some quota windows are exhausted"
        : worst === 2 ? "Some quota windows are running low"
          : measured.every(Boolean) ? "Quota available on all checked accounts" : "Some accounts have no quota data";

  return (
    <section className="space-y-4" aria-label="Provider quota status">
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <div className="flex items-center gap-2 font-semibold text-text-main">
          <span className={`size-2.5 rounded-full ${STATES[worst][1]}`} aria-hidden="true" />{headline}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Showing {connections.length} account{connections.length === 1 ? "" : "s"} on this page. {lastUpdated ? `Last checked ${formatDate(lastUpdated)}.` : "Status updates as checks finish."}
        </p>
      </div>

      <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-semibold text-text-main">Provider quota status</h2>
          <span className="text-xs text-text-muted">Last 30 days · observations from this browser</span>
        </div>
        {[...groups].map(([provider, accounts]) => {
          const buckets = accounts.flatMap(({ id }) => available.get(id));
          const percentages = buckets.map(remainingQuota).filter((value) => value !== null);
          const reset = nextQuotaReset(buckets);
          const state = STATES[quotaSeverity(buckets)];
          return (
            <details className="group px-4 py-3" key={provider}>
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
                    <span className={`size-2 rounded-full ${state[1]}`} aria-hidden="true" />
                    {AI_PROVIDERS[provider]?.name || provider}
                    <span className="font-normal text-text-muted">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span>
                    <span className="material-symbols-outlined text-base text-text-muted group-open:rotate-90" aria-hidden="true">chevron_right</span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {percentages.length ? `Lowest remaining: ${formatPercent(Math.min(...percentages))}` : state[0]}
                    {reset !== null && ` · Next reset ${formatDate(reset)}`}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]">
                  {days.map(({ key, date }) => {
                    const severity = Math.max(0, ...accounts.map(({ id }) => history[key]?.[id] || 0));
                    const [label, color] = STATES[severity] || STATES[0];
                    const description = `${date.toLocaleDateString()}: ${label}`;
                    return <span key={key} className={`h-4 rounded-sm ${color}`} title={description} role="img" aria-label={description} />;
                  })}
                </div>
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {accounts.map((account, index) => {
                  const quotas = available.get(account.id);
                  return (
                    <li className="rounded-lg border border-border-subtle px-3 py-2" key={account.id}>
                      <p className="font-medium text-text-main">{getConnectionLabel(account) || `Account ${index + 1}`}</p>
                      {quotas.length ? quotas.map((quota, quotaIndex) => {
                        const remaining = remainingQuota(quota);
                        const hasReset = quota.resetAt && !quota.neverExpires && Number.isFinite(new Date(quota.resetAt).getTime());
                        return (
                          <div key={quotaIndex} className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
                            <span>{quota.name}: <strong>{quota.unlimited ? "Unlimited" : remaining === null ? "Unknown" : `${formatPercent(remaining)} left`}</strong></span>
                            <span>{hasReset ? `${quota.recurring === false ? "Expires" : "Resets"} ${formatDate(quota.resetAt)}` : "No reset time reported"}</span>
                          </div>
                        );
                      }) : <p className="mt-1 text-xs text-text-muted">{account.isActive === false ? "Turned off" : loading[account.id] ? "Checking…" : "Quota unavailable"}</p>}
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
        <div className="flex flex-wrap gap-3 px-4 py-3 text-xs text-text-muted">
          {STATES.map(([label, color]) => <span key={label} className="flex items-center gap-1.5"><span className={`size-2 rounded-sm ${color}`} aria-hidden="true" />{label}</span>)}
          <span>Each day shows the lowest observed quota.</span>
        </div>
      </div>
    </section>
  );
}
