"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Button, Card, Input, Modal, Select } from "@/shared/components";
import ModelAccessPanel from "@/shared/components/workspaces/ModelAccessPanel";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: Number(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value || 0));
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
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!selected || !workspace) return;
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
          dailyTokenLimit: form.role === "owner" ? 0 : Number(form.dailyTokenLimit || 0),
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
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Used today" value={formatNumber(profile.dashboard.tokenStatus.usedTokens)} icon="data_usage" />
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
                    <p className="text-xs text-text-muted">Counts input and output tokens across all keys owned by this member.</p>
                  </div>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  max="1000000000000"
                  label="Tokens per day"
                  aria-label="Tokens per day"
                  value={form.role === "owner" ? "0" : form.dailyTokenLimit}
                  onChange={(event) => setForm((current) => ({ ...current, dailyTokenLimit: event.target.value }))}
                  disabled={form.role === "owner"}
                  hint={form.role === "owner" ? "Owners always have unlimited usage." : "Use 0 for unlimited usage."}
                />
              </div>

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
