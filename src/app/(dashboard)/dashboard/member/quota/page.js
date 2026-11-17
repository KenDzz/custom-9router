"use client";

import { useEffect, useState } from "react";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { quotaDays, quotaSeverity, recordQuotaSnapshot } from "../../usage/components/ProviderLimits/statusHistory";

const STATES = [
  { label: "No data", color: "bg-surface-3", icon: "help" },
  { label: "Available", color: "bg-emerald-500", icon: "check_circle" },
  { label: "Low quota", color: "bg-amber-400", icon: "warning" },
  { label: "Exhausted", color: "bg-red-500", icon: "error" },
];

const BANNERS = [
  { title: "Quota status unavailable", style: "border-border-subtle", tint: "bg-surface-2 text-text-main" },
  { title: "Provider quota available", style: "border-emerald-500/60", tint: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  { title: "Some providers are running low", style: "border-amber-500/60", tint: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { title: "Some providers have exhausted their quota", style: "border-red-500/60", tint: "bg-red-500/15 text-red-800 dark:text-red-300" },
];

const shortDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const labelFor = (provider) => AI_PROVIDERS[provider]?.name || provider;
const severityFor = (provider) => quotaSeverity([{ unlimited: provider.unlimited, percentage: provider.remainingPercent }]);
const statusFor = (value) => STATES[value] || STATES[0];

function recordHistory(workspace, providers) {
  const key = workspace && `memberProviderQuotaHistory.v1.${workspace}`;
  let history = {};
  try {
    const previous = key ? JSON.parse(window.localStorage.getItem(key) || "{}") : {};
    if (previous && typeof previous === "object" && !Array.isArray(previous)) history = previous;
  } catch { /* History is optional when browser storage is unavailable. */ }
  for (const provider of providers) {
    history = recordQuotaSnapshot(history, provider.provider, severityFor(provider));
  }
  try {
    if (key) window.localStorage.setItem(key, JSON.stringify(history));
  } catch { /* Keep the current observations visible for this visit. */ }
  return history;
}

function formatQuota(provider) {
  const value = provider.remainingPercent;
  if (provider.unlimited) return "Unlimited";
  if (value === null) return "Unavailable";
  if (value > 0 && value < 1) return "<1%";
  return `${Math.floor(value)}%`;
}

export default function MemberQuotaPage() {
  const [providers, setProviders] = useState(null);
  const [history, setHistory] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/quota", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Quota unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setHistory(recordHistory(response.headers.get("X-Quota-Workspace"), data.providers));
          setProviders(data.providers);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);

  const days = quotaDays();
  const severities = (providers || []).map(severityFor);
  const worst = Math.max(0, ...severities);
  const banner = BANNERS[worst];
  const partial = worst === 1 && severities.includes(0);
  const title = error ? "Unable to check provider quota"
    : providers === null ? "Checking provider quota…"
      : providers.length === 0 ? "No providers reporting quota"
        : partial ? "Quota available for some providers" : banner.title;
  const observations = [...days].reverse().flatMap(({ key, date }) =>
    (providers || []).flatMap(({ provider }) => history[key]?.[provider]
      ? [{ key, date, provider, status: statusFor(history[key][provider]) }] : []));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className={`overflow-hidden rounded-lg border bg-surface shadow-[var(--shadow-soft)] ${banner.style}`} aria-label="Quota overview">
        <div className={`flex items-center gap-2 px-4 py-4 font-semibold ${banner.tint}`} role="status">
          <span className="material-symbols-outlined text-lg" aria-hidden="true">{statusFor(worst).icon}</span>
          {title}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-text-muted">
          <p>{error ? "Try again to check the current quota." : "Remaining quota and reset times for providers in this workspace."}</p>
          {(error || providers !== null) && (
            <button type="button" className="font-medium text-primary underline"
              onClick={() => { setError(false); setProviders(null); setRevision((current) => current + 1); }}>
              {error ? "Retry" : "Refresh"}
            </button>
          )}
        </div>
      </section>

      {!error && !!providers?.length && (
        <>
          <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-[var(--shadow-soft)]" aria-labelledby="provider-quota-title">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-3">
              <h2 id="provider-quota-title" className="font-semibold text-text-main">Provider quota status</h2>
              <span className="text-xs text-text-muted">{shortDate(days[0].date)} – {shortDate(days.at(-1).date)}</span>
            </div>
            <ul className="divide-y divide-border-subtle">
              {providers.map((provider) => {
                const status = statusFor(severityFor(provider));
                return (
                  <li key={provider.provider} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                      <span className="inline-flex items-center gap-2 font-medium text-text-main">
                        <span className={`size-2.5 rounded-full ${status.color}`} aria-hidden="true" />
                        {labelFor(provider.provider)}
                        <span className="text-xs font-normal text-text-muted">{status.label}</span>
                      </span>
                      <span className="text-xs text-text-muted">
                        <strong className="text-text-main">{formatQuota(provider)}{provider.remainingPercent !== null && " left"}</strong>
                        {provider.resetAt
                          ? <> · Resets <time dateTime={provider.resetAt}>{new Date(provider.resetAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></>
                          : " · No reset time reported"}
                      </span>
                    </div>
                    <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]" aria-label={`${labelFor(provider.provider)} daily quota observations`}>
                      {days.map(({ key, date }) => {
                        const day = statusFor(history[key]?.[provider.provider]);
                        const description = `${shortDate(date)}: ${day.label}`;
                        return <span key={key} role="img" aria-label={description} title={description} className={`h-4 rounded-[2px] ${day.color}`} />;
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3 text-xs text-text-muted">
              {STATES.map(({ label, color }) => (
                <span key={label} className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-sm ${color}`} aria-hidden="true" />{label}</span>
              ))}
              <span>Observations from this browser only.</span>
            </div>
          </section>

          <div className="text-center">
            <button type="button" className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-text-main hover:bg-surface-2"
              aria-expanded={showHistory} aria-controls="member-quota-history" onClick={() => setShowHistory((current) => !current)}>
              <span className="material-symbols-outlined text-base" aria-hidden="true">calendar_today</span>
              {showHistory ? "Hide history" : "View history"}
            </button>
          </div>
          <section id="member-quota-history" hidden={!showHistory} className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
            <h2 className="font-semibold text-text-main">Quota history</h2>
            <p className="mt-1 text-xs text-text-muted">Lowest quota observed each day. Days without a reading are left blank.</p>
            {observations.length ? (
              <ul className="mt-3 max-h-64 divide-y divide-border-subtle overflow-y-auto text-sm">
                {observations.map(({ key, date, provider, status }) => (
                  <li key={`${key}:${provider}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{shortDate(date)} · {labelFor(provider)}</span>
                    <span className="inline-flex items-center gap-1.5 text-text-muted"><span className={`size-2 rounded-full ${status.color}`} aria-hidden="true" />{status.label}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-text-muted">No quota observations yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}
