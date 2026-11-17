"use client";

import { useEffect, useState } from "react";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import Card from "@/shared/components/Card";

function formatQuota(provider) {
  const value = provider.remainingPercent;
  if (provider.unlimited) return "Unlimited";
  if (value === null) return "Unavailable";
  if (value > 0 && value < 1) return "<1%";
  return `${Math.floor(value)}%`;
}

export default function MemberQuotaPage() {
  const [providers, setProviders] = useState(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/member/quota", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Quota unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setProviders(data.providers);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <Card title="Provider quota" subtitle="Remaining quota and reset time for providers in this workspace" icon="data_usage">
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <p>Provider quota could not be loaded.</p>
          <button type="button" className="font-medium text-primary underline"
            onClick={() => { setError(false); setRevision((current) => current + 1); }}>Retry</button>
        </div>
      ) : providers === null ? (
        <p role="status" className="text-sm text-text-muted">Checking provider quota…</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-text-muted">No providers with quota reporting are active in this workspace.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Provider</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Remaining</th>
                  <th scope="col" className="py-2 font-medium">Reset time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
                {providers.map((provider) => (
                  <tr key={provider.provider}>
                    <th scope="row" className="py-3 pr-4 font-semibold text-text-main">{AI_PROVIDERS[provider.provider]?.name || provider.provider}</th>
                    <td className={`py-3 pr-4 ${provider.remainingPercent === 0 ? "text-red-600 dark:text-red-400" : "text-text-main"}`}>
                      {formatQuota(provider)}
                    </td>
                    <td className="py-3 text-text-muted">
                      {provider.resetAt ? <time dateTime={provider.resetAt}>{new Date(provider.resetAt).toLocaleString()}</time> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-text-muted">Each provider shows its best available quota and the reset time of the limit that determines it.</p>
        </>
      )}
    </Card>
  );
}
