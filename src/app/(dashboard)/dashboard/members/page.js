"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Button, Card, ConfirmModal, Input, Modal, Select } from "@/shared/components";
import ModelAccessPanel from "@/shared/components/workspaces/ModelAccessPanel";
import DailyTokenLimitInput from "@/shared/components/workspaces/DailyTokenLimitInput";
import { formatDailyTokenLimitInput, normalizeDailyTokenLimitInput, parseDailyTokenLimit } from "@/shared/utils/dailyTokenLimit";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: Number(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function newGiftForm() {
  const now = new Date();
  return {
    type: "tokens",
    amount: "",
    startsAt: localDateTimeValue(now),
    endsAt: localDateTimeValue(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
  };
}

function displayDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function MembersPage() {
  const [workspace, setWorkspace] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [form, setForm] = useState({ username: "", displayName: "", email: "", role: "member", dailyTokenLimit: "0", newPassword: "" });
  const [giftForm, setGiftForm] = useState(newGiftForm);
  const [gifting, setGifting] = useState(false);
  const [resettingUsage, setResettingUsage] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const me = await readResponse(await fetch("/api/users/me", { cache: "no-store" }));
      const active = (me.workspaces || []).find((item) => item.id === me.activeWorkspaceId);
      if (!active || active.role !== "owner") throw new Error("Owner access required");
      setWorkspace(active);
      setCurrentUserId(me.user?.id || null);
      const data = await readResponse(await fetch(`/api/workspaces/${active.id}/members`, { cache: "no-store" }));
      setMembers(data.members || []);
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) loadMembers(); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) => [member.displayName, member.username, member.email, member.role]
      .filter(Boolean).some((value) => value.toLowerCase().includes(needle)));
  }, [members, query]);

  const openProfile = async (member) => {
    setSelected(member);
    setProfile(null);
    setProfileLoading(true);
    setStatus({ type: "", message: "" });
    setGiftForm(newGiftForm());
    setForm({
      username: member.username || "",
      displayName: member.displayName || "",
      email: member.email || "",
      role: member.role,
      dailyTokenLimit: String(member.dailyTokenLimit || 0),
      newPassword: "",
    });
    try {
      const data = await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${member.userId}/profile`, { cache: "no-store" }));
      setProfile(data);
      setForm({
        username: data.user.username || "",
        displayName: data.user.displayName || "",
        email: data.user.email || "",
        role: data.member.role,
        dailyTokenLimit: String(data.member.dailyTokenLimit || 0),
        newPassword: "",
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setProfileLoading(false);
    }
  };

  const closeProfile = () => {
    setSelected(null);
    setProfile(null);
    setStatus({ type: "", message: "" });
    setResetConfirmOpen(false);
  };

  const grantGift = async () => {
    if (!selected || !workspace) return;
    const amount = giftForm.type === "tokens" ? parseDailyTokenLimit(giftForm.amount) : Number(giftForm.amount);
    const max = giftForm.type === "tokens" ? 1_000_000_000_000 : 1_000;
    const startsAt = new Date(giftForm.startsAt);
    const endsAt = new Date(giftForm.endsAt);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > max
      || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      setStatus({ type: "error", message: "Enter a valid amount and a finish time after the start time." });
      return;
    }
    setGifting(true);
    setStatus({ type: "", message: "" });
    try {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${selected.userId}/gifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: giftForm.type, amount, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
      }));
      const updated = await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${selected.userId}/profile`, { cache: "no-store" }));
      setProfile(updated);
      setGiftForm((current) => ({ ...current, amount: "" }));
      setStatus({ type: "success", message: "Gift added to this member" });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setGifting(false);
    }
  };

  const resetUsage = async () => {
    if (!selected || !workspace) return;
    setResettingUsage(true);
    try {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${selected.userId}/usage-reset`, { method: "POST" }));
      const updated = await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${selected.userId}/profile`, { cache: "no-store" }));
      setProfile(updated);
      setResetConfirmOpen(false);
      setStatus({ type: "success", message: "Usage toward the daily limit reset; request history was preserved" });
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setResettingUsage(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!selected || !workspace) return;
    const limit = form.role === "owner" ? 0 : parseDailyTokenLimit(form.dailyTokenLimit);
    if (limit === null) {
      setStatus({ type: "error", message: "Enter a daily token limit from 0 to 1,000,000,000,000." });
      return;
    }
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const data = await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${selected.userId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          role: form.role,
          dailyTokenLimit: limit,
          ...(form.newPassword ? { newPassword: form.newPassword } : {}),
        }),
      }));
      setProfile(data);
      setMembers((current) => current.map((member) => member.userId === selected.userId ? {
        ...member,
        ...data.user,
        role: form.role,
        dailyTokenLimit: data.member.dailyTokenLimit,
      } : member));
      setSelected((current) => ({ ...current, ...data.user, role: form.role, dailyTokenLimit: data.member.dailyTokenLimit }));
      setForm((current) => ({ ...current, newPassword: "" }));
      setStatus({ type: "success", message: "Member profile updated" });
      if (selected.userId === currentUserId) globalThis.location.reload();
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-500">
            <span className="material-symbols-outlined text-[17px]">admin_panel_settings</span>
            Owner controls
          </div>
          <h1 className="text-2xl font-bold text-text-main">Member management</h1>
          <p className="mt-1 text-sm text-text-muted">Manage profiles, passwords, token limits and model access for {workspace?.name || "this workspace"}.</p>
        </div>
        <Badge variant="primary" icon="group">{members.length} members</Badge>
      </div>

      {status.message && !selected && (
        <div className={`rounded-[10px] border px-4 py-3 text-sm ${status.type === "error" ? "border-red-500/20 bg-red-500/10 text-red-600" : "border-green-500/20 bg-green-500/10 text-green-600"}`}>
          {status.message}
        </div>
      )}

      {workspace && <ModelAccessPanel key={workspace.id} workspaceId={workspace.id} />}

      <Card padding="none">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-text-main">Workspace members</h2>
            <p className="text-xs text-text-muted">Daily limits reset at midnight on the 9Router server.</p>
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search members"
            aria-label="Search members"
            icon="search"
            className="w-full sm:w-64"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-text-muted">
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            Loading members…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-text-muted">No members match your search.</div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {filtered.map((member) => (
              <button
                key={member.userId}
                type="button"
                onClick={() => openProfile(member)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 sm:px-5"
              >
                <Avatar name={member.displayName || member.username} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-main">{member.displayName || member.username}</span>
                  <span className="block truncate text-xs text-text-muted">@{member.username}{member.email ? ` · ${member.email}` : ""}</span>
                  <span className="block text-xs text-text-muted sm:hidden">{member.role === "owner" || !member.dailyTokenLimit ? "Unlimited" : `${formatNumber(member.dailyTokenLimit)} tokens / day`}</span>
                </span>
                <span className="hidden text-right sm:block">
                  <span className="block text-xs font-medium text-text-main">
                    {member.role === "owner" || !member.dailyTokenLimit ? "Unlimited" : `${formatNumber(member.dailyTokenLimit)} / day`}
                  </span>
                  <span className="text-[11px] text-text-muted">Token limit</span>
                </span>
                <Badge variant={member.role === "owner" ? "primary" : member.role === "admin" ? "info" : "default"} size="sm">
                  {member.role}
                </Badge>
                <span className="material-symbols-outlined text-[19px] text-text-muted">chevron_right</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Modal isOpen onClose={closeProfile} title="Member profile" size="full" className="max-w-3xl">
          {profileLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              Loading profile…
            </div>
          ) : (
            <form onSubmit={saveProfile} className="space-y-6">
              <div className="flex items-center gap-4 rounded-[14px] border border-border-subtle bg-surface-2/50 p-4">
                <Avatar name={form.displayName || form.username} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-text-main">{form.displayName || form.username}</h3>
                  <p className="truncate text-xs text-text-muted">@{form.username}</p>
                </div>
                <Badge variant={form.role === "owner" ? "primary" : form.role === "admin" ? "info" : "default"}>{form.role}</Badge>
              </div>

              {profile?.dashboard && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Metric label="Used today" value={formatNumber(profile.dashboard.tokenStatus.usedTokens)} icon="data_usage" />
                  <Metric label="Total recorded today" value={formatNumber(profile.dashboard.tokenStatus.actualUsedToday)} icon="history" />
                  <Metric
                    label="Remaining today"
                    value={profile.dashboard.tokenStatus.remainingTokens === null
                      ? "Unlimited"
                      : formatDailyTokenLimitInput(profile.dashboard.tokenStatus.remainingTokens)}
                    icon="hourglass_bottom"
                  />
                  <Metric label="Requests today" value={formatNumber(profile.dashboard.tokenStatus.requests)} icon="bolt" />
                  <Metric label="Active keys" value={`${profile.dashboard.keys.active}/${profile.dashboard.keys.total}`} icon="vpn_key" />
                </div>
              )}

              <p className="text-xs text-text-muted">Profile and password changes apply to this account in all workspaces. Role and daily limit apply only to this workspace.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Username" aria-label="Username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
                <Input label="Display name" aria-label="Display name" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
                <Input label="Email" aria-label="Email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                <Select label="Workspace role" aria-label="Workspace role" options={ROLE_OPTIONS} value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} />
              </div>

              <div className="rounded-[14px] border border-border-subtle p-4">
                <div className="mb-4 flex items-start gap-3">
                  <span className="material-symbols-outlined rounded-[10px] bg-brand-500/10 p-2 text-brand-500">speed</span>
                  <div>
                    <h4 className="font-semibold text-text-main">Daily token limit</h4>
                    <p className="text-xs text-text-muted">Maximum base tokens per day, not the remaining balance. Reset usage sets Used today to zero; Total recorded today and request history stay unchanged. Remaining today also includes active gift tokens. Usage counts input and output tokens across all keys owned by this member.</p>
                  </div>
                </div>
                <DailyTokenLimitInput
                  value={form.role === "owner" ? "0" : form.dailyTokenLimit}
                  onChange={(dailyTokenLimit) => setForm((current) => ({ ...current, dailyTokenLimit }))}
                  disabled={form.role === "owner"}
                />
              </div>

              {form.role !== "owner" && profile?.dashboard && (
                <section className="rounded-[14px] border border-border-subtle p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-text-main">Member gifts</h4>
                      <p className="mt-1 text-xs text-text-muted">One-time tokens and reset passes stack while each gift is active. Resetting the quota counter keeps request history.</p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" icon="restart_alt" disabled={!profile.dashboard.tokenStatus.dailyTokenLimit || !profile.dashboard.tokenStatus.usedTokens} onClick={() => setResetConfirmOpen(true)}>
                      Reset usage now
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Metric label="Gift tokens remaining" value={formatDailyTokenLimitInput(profile.dashboard.tokenStatus.tokenGiftRemaining || 0)} icon="redeem" />
                    <Metric label="Reset passes available" value={formatDailyTokenLimitInput(profile.dashboard.tokenStatus.resetGiftsAvailable || 0)} icon="restart_alt" />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Select
                      label="Gift type"
                      aria-label="Gift type"
                      options={[{ value: "tokens", label: "One-time tokens" }, { value: "reset", label: "Usage reset passes" }]}
                      value={giftForm.type}
                      onChange={(event) => setGiftForm((current) => ({ ...current, type: event.target.value, amount: "" }))}
                    />
                    <Input
                      label={giftForm.type === "tokens" ? "Token amount" : "Number of resets"}
                      type="text"
                      inputMode="numeric"
                      maxLength={giftForm.type === "tokens" ? 17 : 4}
                      placeholder={giftForm.type === "tokens" ? "e.g. 1,000,000" : "e.g. 2"}
                      value={giftForm.type === "tokens" ? formatDailyTokenLimitInput(giftForm.amount) : giftForm.amount}
                      onChange={(event) => {
                        const digits = normalizeDailyTokenLimitInput(event.target.value);
                        if (digits !== null) setGiftForm((current) => ({ ...current, amount: digits }));
                      }}
                    />
                    <Input
                      label="Starts at"
                      type="datetime-local"
                      step="1"
                      value={giftForm.startsAt}
                      onChange={(event) => setGiftForm((current) => ({ ...current, startsAt: event.target.value }))}
                    />
                    <Input
                      label="Ends at"
                      type="datetime-local"
                      step="1"
                      value={giftForm.endsAt}
                      onChange={(event) => setGiftForm((current) => ({ ...current, endsAt: event.target.value }))}
                    />
                  </div>
                  <p className="mt-2 text-xs text-text-muted">Times use your local time zone, including seconds. Each gift is available from its start time until its end time.</p>
                  <div className="mt-3 flex justify-end">
                    <Button type="button" icon="redeem" loading={gifting} onClick={grantGift}>Give gift</Button>
                  </div>
                  {(profile.dashboard.gifts || []).length > 0 && (
                    <div className="mt-5 space-y-2 border-t border-border-subtle pt-4">
                      <h5 className="text-sm font-semibold text-text-main">Gift history</h5>
                      {profile.dashboard.gifts.map((gift) => (
                          <div key={gift.id} className="rounded-[10px] bg-surface-2/50 p-3 text-xs text-text-muted">
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-medium text-text-main">{gift.type === "tokens" ? "One-time tokens" : "Reset passes"}: {formatDailyTokenLimitInput(gift.remainingAmount)} / {formatDailyTokenLimitInput(gift.amount)} left</span>
                              <span className="capitalize">{gift.status}</span>
                            </div>
                            <p className="mt-1">{displayDateTime(gift.startsAt)} → {displayDateTime(gift.endsAt)}</p>
                          </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {profile && <ModelAccessPanel key={selected.userId} workspaceId={workspace.id} userId={selected.userId} />}

              <div className="rounded-[14px] border border-border-subtle p-4">
                <h4 className="font-semibold text-text-main">Reset password</h4>
                <p className="mb-4 text-xs text-text-muted">Leave empty to keep the current password. Minimum 8 characters.</p>
                <Input type="password" label="New password" aria-label="New password" value={form.newPassword} onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" />
              </div>

              {status.message && (
                <div className={`rounded-[10px] px-3 py-2.5 text-sm ${status.type === "error" ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-600"}`}>
                  {status.message}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeProfile}>Cancel</Button>
                <Button type="submit" icon="save" loading={saving} disabled={!profile}>Save changes</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
      <ConfirmModal
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={resetUsage}
        title="Reset member usage"
        message="Reset usage toward today's token limit now? Request history and spent gift tokens stay unchanged."
        confirmText="Reset usage"
        variant="primary"
        loading={resettingUsage}
      />
    </div>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="rounded-[12px] border border-border-subtle bg-surface-2/40 p-3">
      <span className="material-symbols-outlined text-[18px] text-brand-500">{icon}</span>
      <p className="mt-2 text-lg font-bold text-text-main">{value}</p>
      <p className="text-[11px] text-text-muted">{label}</p>
    </div>
  );
}
