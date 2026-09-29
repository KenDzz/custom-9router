"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, ConfirmModal, Input, Modal } from "@/shared/components";

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: Number(value) >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function maskKey(value) {
  if (!value) return "";
  return `${value.slice(0, 7)}${"•".repeat(Math.min(22, Math.max(8, value.length - 11)))}${value.slice(-4)}`;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function MemberDashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [modelAccess, setModelAccess] = useState(null);
  const [keys, setKeys] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [visibleKeys, setVisibleKeys] = useState(new Set());
  const [deleteKey, setDeleteKey] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async ({ quiet = false } = {}) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const [overview, keyData, me] = await Promise.all([
        fetch("/api/member/overview", { cache: "no-store" }).then(readResponse),
        fetch("/api/member/keys", { cache: "no-store" }).then(readResponse),
        fetch("/api/users/me", { cache: "no-store" }).then(readResponse),
      ]);
      setDashboard(overview.dashboard);
      setModelAccess(overview.modelAccess);
      setKeys(keyData.keys || []);
      setWorkspace((me.workspaces || []).find((item) => item.id === me.activeWorkspaceId) || null);
      if (!quiet) setStatus({ type: "", message: "" });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        setEndpoint(`${globalThis.location.origin}/v1`);
        load();
      }
    });
    return () => { active = false; };
  }, []);

  const maxChartValue = useMemo(() => Math.max(1, ...(dashboard?.chart || []).map((item) => item.tokens)), [dashboard]);

  const createKey = async (event) => {
    event.preventDefault();
    if (!keyName.trim()) return;
    setCreating(true);
    setCreateError("");
    setStatus({ type: "", message: "" });
    try {
      const data = await readResponse(await fetch("/api/member/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim() }),
      }));
      setKeys((current) => [...current, data.key]);
      setVisibleKeys((current) => new Set(current).add(data.key.id));
      setKeyName("");
      setCreateOpen(false);
      setStatus({ type: "success", message: "API key created. Copy it and keep it secure." });
      await load({ quiet: true });
    } catch (error) {
      setCreateError(error.message);
    } finally {
      setCreating(false);
    }
  };

  const toggleKey = async (key) => {
    try {
      const data = await readResponse(await fetch(`/api/member/keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !key.isActive }),
      }));
      setKeys((current) => current.map((item) => item.id === key.id ? data.key : item));
      await load({ quiet: true });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  };

  const confirmDelete = async () => {
    if (!deleteKey) return;
    setDeleting(true);
    try {
      await readResponse(await fetch(`/api/member/keys/${deleteKey.id}`, { method: "DELETE" }));
      setKeys((current) => current.filter((item) => item.id !== deleteKey.id));
      setDeleteKey(null);
      setStatus({ type: "success", message: "API key deleted" });
      await load({ quiet: true });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setDeleting(false);
    }
  };

  const copy = async (value, message = "Copied") => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({ type: "success", message });
    } catch {
      setStatus({ type: "error", message: "Clipboard access is unavailable" });
    }
  };

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-text-muted"><span className="material-symbols-outlined animate-spin">progress_activity</span>Loading your workspace…</div>;
  }

  if (!dashboard) {
    return <Card title="Unable to load your workspace" icon="error">
      <p role="alert" className="mb-4 text-sm text-red-600">{status.message || "Usage data is unavailable."}</p>
      <Button variant="secondary" icon="refresh" loading={refreshing} onClick={() => load({ quiet: true })}>Try again</Button>
    </Card>;
  }

  const token = dashboard?.tokenStatus;
  const unlimited = !token?.dailyTokenLimit;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-500">
            <span className="material-symbols-outlined text-[17px]">workspaces</span>
            {workspace?.name || "Workspace"}
          </div>
          <h1 className="text-2xl font-bold text-text-main">My usage</h1>
          <p className="mt-1 text-sm text-text-muted">Track your daily allowance and manage the keys assigned to your account.</p>
        </div>
        <Button variant="secondary" icon="refresh" loading={refreshing} onClick={() => load({ quiet: true })}>Refresh</Button>
      </div>

      {status.message && (
        <div className={`flex items-start gap-2 rounded-[10px] border px-4 py-3 text-sm ${status.type === "error" ? "border-red-500/20 bg-red-500/10 text-red-600" : "border-green-500/20 bg-green-500/10 text-green-600"}`}>
          <span className="material-symbols-outlined text-[18px]">{status.type === "error" ? "error" : "check_circle"}</span>
          {status.message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden" padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Daily token allowance</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-text-main">{formatNumber(token?.usedTokens)}</span>
                <span className="text-sm text-text-muted">/ {unlimited ? "Unlimited" : formatNumber(token.dailyTokenLimit)}</span>
              </div>
            </div>
            <div className={`grid size-11 place-items-center rounded-[12px] ${token?.limitReached ? "bg-red-500/10 text-red-500" : "bg-brand-500/10 text-brand-500"}`}>
              <span className="material-symbols-outlined">speed</span>
            </div>
          </div>
          <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={`h-full rounded-full transition-all ${token?.limitReached ? "bg-red-500" : token?.percentage >= 80 ? "bg-amber-500" : "bg-brand-500"}`}
              style={{ width: unlimited ? "0%" : `${Math.max(2, token?.percentage || 0)}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-text-muted">
            <span>{unlimited ? "No daily limit" : `${token.percentage}% used · ${formatNumber(token.remainingTokens)} remaining`}</span>
            <span>Resets {token?.resetsAt ? new Date(token.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "at midnight"}</span>
          </div>
          {token?.limitReached && (
            <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-red-500/10 px-3 py-2.5 text-sm text-red-600">
              <span className="material-symbols-outlined text-[18px]">block</span>
              API requests are paused until the daily limit resets.
            </div>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <MiniStat label="Requests today" value={formatNumber(token?.requests)} icon="bolt" />
          <MiniStat label="Active API keys" value={`${dashboard?.keys.active || 0}/${dashboard?.keys.total || 0}`} icon="vpn_key" />
        </div>
      </div>

      {modelAccess && <Card title="My model access" subtitle={modelAccess.inheritsWorkspace ? "Inherited from your workspace" : "Assigned by your Owner, within the workspace allowance"} icon="tune">
        {modelAccess.mode === "all" ? <p className="text-sm text-text-muted">You can use all configured models and combos.</p> : <>
          {!modelAccess.models.length && !modelAccess.combos.length && <p className="text-sm text-amber-600">No models or combos allowed. Ask your Owner to grant access.</p>}
          <div className="flex flex-wrap gap-2">
            {modelAccess.models.map((model) => <span key={model} className="max-w-full break-all rounded-[8px] bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-main">{model}</span>)}
            {modelAccess.combos.map((combo) => <Badge key={combo.id} variant="primary" icon="route">{combo.name}</Badge>)}
          </div>
          <p className="mt-3 text-xs text-text-muted">Use a model ID or combo name in your request. Combo access does not grant direct access to its models.</p>
        </>}
      </Card>}

      <Card title="Last 7 days" subtitle="Input and output tokens charged to your API keys" icon="bar_chart">
        <div className="flex h-44 items-end gap-2 sm:gap-3">
          {(dashboard?.chart || []).map((item) => (
            <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-medium text-text-muted">{formatNumber(item.tokens)}</span>
              <div className="flex h-28 w-full items-end overflow-hidden rounded-[8px] bg-surface-2">
                <div className="w-full rounded-[8px] bg-gradient-to-t from-brand-600 to-brand-400 transition-all" style={{ height: `${Math.max(item.tokens ? 6 : 1, (item.tokens / maxChartValue) * 100)}%` }} />
              </div>
              <span className="text-[11px] text-text-muted">{item.label}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="My API keys"
        subtitle="Only keys created by your account are shown"
        icon="vpn_key"
        action={<Button size="sm" icon="add" onClick={() => { setCreateError(""); setCreateOpen(true); }}>Create key</Button>}
      >
        <div className="mb-4 rounded-[10px] border border-border-subtle bg-bg p-3">
          <p className="mb-1 text-xs font-medium text-text-muted">OpenAI-compatible base URL</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-text-main">{endpoint}</code>
            <Button variant="ghost" size="sm" icon="content_copy" aria-label="Copy base URL" onClick={() => copy(endpoint, "Base URL copied")} />
          </div>
          <p className="mt-1 text-xs text-text-muted">Use your key as the Bearer token. All your keys share the same daily allowance.</p>
        </div>
        <div className="divide-y divide-border-subtle">
          {keys.length === 0 ? (
            <div className="p-10 text-center">
              <span className="material-symbols-outlined text-[32px] text-text-muted">key_off</span>
              <p className="mt-2 text-sm font-medium text-text-main">No API keys yet</p>
              <p className="text-xs text-text-muted">Create a key to start using this workspace.</p>
            </div>
          ) : keys.map((key) => {
            const visible = visibleKeys.has(key.id);
            return (
              <div key={key.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${key.isActive ? "bg-green-500/10 text-green-600" : "bg-surface-2 text-text-muted"}`}>
                  <span className="material-symbols-outlined text-[19px]">vpn_key</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text-main">{key.name}</p>
                    <Badge variant={key.isActive ? "success" : "default"} size="sm" dot>{key.isActive ? "Active" : "Paused"}</Badge>
                  </div>
                  <code className="mt-1 block truncate text-xs text-text-muted">{visible ? key.key : maskKey(key.key)}</code>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-auto">
                  <Button variant="ghost" size="sm" icon={visible ? "visibility_off" : "visibility"} aria-label={visible ? `Hide ${key.name}` : `Show ${key.name}`} onClick={() => setVisibleKeys((current) => { const next = new Set(current); next.has(key.id) ? next.delete(key.id) : next.add(key.id); return next; })} />
                  <Button variant="ghost" size="sm" icon="content_copy" aria-label={`Copy ${key.name}`} onClick={() => copy(key.key, "API key copied")} />
                  <Button variant="ghost" size="sm" icon={key.isActive ? "pause" : "play_arrow"} aria-label={key.isActive ? `Pause ${key.name}` : `Enable ${key.name}`} onClick={() => toggleKey(key)} />
                  <Button variant="ghost" size="sm" icon="delete" aria-label={`Delete ${key.name}`} className="text-red-500" onClick={() => setDeleteKey(key)} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Recent requests" subtitle="Latest usage from your keys" icon="history">
        <div className="divide-y divide-border-subtle">
          {(dashboard?.recent || []).length === 0 ? (
            <div className="p-10 text-center text-sm text-text-muted">No usage recorded yet.</div>
          ) : dashboard.recent.map((item, index) => (
            <div key={`${item.timestamp}-${index}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className={`size-2 rounded-full ${item.status === "ok" ? "bg-green-500" : "bg-red-500"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-main">{item.model || "Unknown model"}</p>
                <p className="text-[11px] text-text-muted">{item.provider || "Unknown provider"} · {new Date(item.timestamp).toLocaleString()}</p>
              </div>
              <span className="text-xs font-semibold text-text-main">{formatNumber(item.totalTokens)}</span>
            </div>
          ))}
        </div>
      </Card>

      {createOpen && (
        <Modal isOpen onClose={() => setCreateOpen(false)} title="Create API key" size="sm" footer={
          <><Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button><Button onClick={createKey} loading={creating} disabled={!keyName.trim()} icon="add">Create key</Button></>
        }>
          <form onSubmit={createKey}>
            {createError && <p role="alert" className="mb-3 text-sm text-red-600">{createError}</p>}
            <Input label="Key name" aria-label="Key name" value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="e.g. My laptop" maxLength={80} required autoFocus hint="Use a name that identifies where this key will be used." />
          </form>
        </Modal>
      )}

      <ConfirmModal
        isOpen={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete API key"
        message={`Delete “${deleteKey?.name || "this key"}”? Applications using it will stop working immediately.`}
        confirmText="Delete key"
      />
    </div>
  );
}

function MiniStat({ label, value, icon }) {
  return (
    <Card padding="sm" className="flex items-center gap-3">
      <div className="grid size-9 place-items-center rounded-[10px] bg-brand-500/10 text-brand-500"><span className="material-symbols-outlined text-[19px]">{icon}</span></div>
      <div><p className="text-xl font-bold text-text-main">{value}</p><p className="text-[11px] text-text-muted">{label}</p></div>
    </Card>
  );
}
