"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Avatar from "./Avatar";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal, { ConfirmModal } from "./Modal";
import Select from "./Select";
import DailyTokenLimitInput from "./workspaces/DailyTokenLimitInput";
import { formatDailyTokenLimitInput, parseDailyTokenLimit } from "@/shared/utils/dailyTokenLimit";

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_VARIANTS = {
  owner: "primary",
  admin: "info",
  member: "default",
};

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function WorkspaceMark({ size = "md" }) {
  const sizes = size === "sm" ? "size-8 rounded-[9px]" : "size-10 rounded-[11px]";
  return (
    <div
      aria-hidden="true"
      className={`${sizes} shrink-0 grid place-items-center bg-brand-500/10 text-brand-600 dark:text-brand-300`}
    >
      <span className="material-symbols-outlined text-[20px]">workspaces</span>
    </div>
  );
}

function RoleBadge({ role }) {
  return (
    <Badge variant={ROLE_VARIANTS[role] || "default"} size="sm">
      {ROLE_LABELS[role] || role}
    </Badge>
  );
}

function InlineStatus({ status }) {
  if (!status?.message) return null;
  const success = status.type === "success";
  return (
    <div className={`flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-sm ${
      success
        ? "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300"
        : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
    }`}>
      <span className="material-symbols-outlined text-[18px] mt-px">
        {success ? "check_circle" : "error"}
      </span>
      <span className="min-w-0 break-words">{status.message}</span>
    </div>
  );
}

function CreateWorkspaceModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event?.preventDefault();
    if (!name.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      await onCreate(name.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create workspace"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button type="submit" form="create-workspace-form" icon="add" loading={loading} disabled={!name.trim()}>
            Create workspace
          </Button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3 rounded-[12px] bg-surface-2/70 p-3.5">
          <WorkspaceMark name={name || "Workspace"} />
          <div>
            <p className="font-medium text-text-main">A separate routing environment</p>
            <p className="mt-0.5 text-xs leading-5 text-text-muted">
              Providers, API keys, combos, usage, and settings stay isolated from your other workspaces.
            </p>
          </div>
        </div>
        <Input
          label="Workspace name"
          placeholder="e.g. Production, Madison Team"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error}
          maxLength={80}
          required
          autoFocus
        />
      </form>
    </Modal>
  );
}

function WorkspaceManagerModal({
  isOpen,
  onClose,
  workspace,
  currentUser,
  onWorkspaceUpdated,
  onWorkspaceDeleted,
}) {
  const [tab, setTab] = useState("general");
  const [name, setName] = useState(workspace?.name || "");
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState("");
  const [status, setStatus] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [memberForm, setMemberForm] = useState({ identifier: "", role: "member", dailyTokenLimit: "0" });
  const [inviteForm, setInviteForm] = useState({ email: "", role: "member", dailyTokenLimit: "0" });
  const [inviteLink, setInviteLink] = useState("");

  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const isOwner = workspace?.role === "owner";

  useEffect(() => {
    if (!isOpen || !workspace) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const requests = [fetch(`/api/workspaces/${workspace.id}/members`, { cache: "no-store" })];
        if (canManage) requests.push(fetch(`/api/workspaces/${workspace.id}/invites`, { cache: "no-store" }));
        const responses = await Promise.all(requests);
        const membersData = await readResponse(responses[0]);
        const invitesData = canManage ? await readResponse(responses[1]) : { invites: [] };
        if (!cancelled) {
          setMembers(membersData.members || []);
          setInvites((invitesData.invites || []).filter((invite) => (
            !invite.acceptedAt
            && !invite.revokedAt
            && new Date(invite.expiresAt).getTime() > Date.now()
          )));
        }
      } catch (err) {
        if (!cancelled) setStatus({ type: "error", message: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen, workspace, canManage]);

  const runAction = async (key, callback, successMessage) => {
    setAction(key);
    setStatus(null);
    try {
      await callback();
      if (successMessage) setStatus({ type: "success", message: successMessage });
      return true;
    } catch (err) {
      setStatus({ type: "error", message: err.message });
      return false;
    } finally {
      setAction("");
    }
  };

  const rename = async (event) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === workspace.name) return;
    await runAction("rename", async () => {
      const data = await readResponse(await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      }));
      onWorkspaceUpdated({ ...workspace, ...data.workspace });
    }, "Workspace name updated");
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!memberForm.identifier.trim()) return;
    const limit = isOwner ? parseDailyTokenLimit(memberForm.dailyTokenLimit) : undefined;
    if (isOwner && limit === null) {
      setStatus({ type: "error", message: "Enter a daily token limit from 0 to 1,000,000,000,000." });
      return;
    }
    await runAction("add-member", async () => {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: memberForm.identifier.trim(), role: memberForm.role, dailyTokenLimit: limit }),
      }));
      const data = await readResponse(await fetch(`/api/workspaces/${workspace.id}/members`, { cache: "no-store" }));
      setMembers(data.members || []);
      setMemberForm({ identifier: "", role: "member", dailyTokenLimit: "0" });
    }, "Member added to this workspace");
  };

  const inviteMember = async (event) => {
    event.preventDefault();
    if (!inviteForm.email.trim()) return;
    const limit = isOwner ? parseDailyTokenLimit(inviteForm.dailyTokenLimit) : undefined;
    if (isOwner && limit === null) {
      setStatus({ type: "error", message: "Enter a daily token limit from 0 to 1,000,000,000,000." });
      return;
    }
    await runAction("invite", async () => {
      const data = await readResponse(await fetch(`/api/workspaces/${workspace.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteForm.email.trim(), role: inviteForm.role, dailyTokenLimit: limit }),
      }));
      const link = `${window.location.origin}/invite?token=${encodeURIComponent(data.invite.token)}`;
      setInviteLink(link);
      setInvites((current) => [data.invite, ...current]);
      setInviteForm({ email: "", role: "member", dailyTokenLimit: "0" });
    }, "Invitation created — copy the link and send it to the member");
  };

  const updateRole = async (member, role) => {
    await runAction(`role-${member.userId}`, async () => {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }));
      setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item));
    }, `${member.displayName || member.username || "Member"} is now ${ROLE_LABELS[role].toLowerCase()}`);
  };

  const removeMember = async (member) => {
    await runAction(`remove-${member.userId}`, async () => {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/members/${member.userId}`, { method: "DELETE" }));
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
    }, `${member.displayName || member.username || "Member"} removed`);
  };

  const revokeInvite = async (invite) => {
    await runAction(`invite-${invite.id}`, async () => {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}/invites/${invite.id}`, { method: "DELETE" }));
      setInvites((current) => current.filter((item) => item.id !== invite.id));
    }, `Invitation for ${invite.email} revoked`);
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setStatus({ type: "success", message: "Invitation link copied" });
    } catch {
      setStatus({ type: "error", message: "Could not copy automatically. Select and copy the link manually." });
    }
  };

  const deleteWorkspace = async () => {
    const deleted = await runAction("delete", async () => {
      await readResponse(await fetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" }));
      await onWorkspaceDeleted(workspace.id);
    });
    if (deleted) {
      setDeleteOpen(false);
      onClose();
    } else {
      setDeleteOpen(false);
    }
  };

  const pendingInvites = invites;

  if (!workspace) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Workspace settings" size="full" className="max-w-3xl">
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-[14px] border border-border-subtle bg-surface-2/50 p-4 sm:flex-row sm:items-center">
            <WorkspaceMark name={workspace.name} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold text-text-main">{workspace.name}</h3>
                <RoleBadge role={workspace.role} />
                {workspace.isDefault && <Badge size="sm" icon="home">Default</Badge>}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Providers, keys, combos, usage, and routing are isolated in this workspace.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-[10px] bg-surface p-1 border border-border-subtle">
              {[
                ["general", "settings", "General"],
                ["members", "group", "Members"],
              ].map(([value, icon, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setTab(value); setStatus(null); }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition-colors ${
                    tab === value ? "bg-brand-500 text-white shadow-sm" : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <InlineStatus status={status} />

          {tab === "general" ? (
            <div className="space-y-5">
              <section className="rounded-[14px] border border-border-subtle p-5">
                <div className="mb-4">
                  <h4 className="font-semibold text-text-main">Workspace details</h4>
                  <p className="mt-1 text-sm text-text-muted">Choose a clear name your team can recognize.</p>
                </div>
                <form onSubmit={rename} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Input
                    label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={!canManage}
                    maxLength={80}
                    className="flex-1"
                  />
                  {canManage && (
                    <Button type="submit" variant="secondary" loading={action === "rename"} disabled={!name.trim() || name.trim() === workspace.name}>
                      Save changes
                    </Button>
                  )}
                </form>
              </section>

              <section className="rounded-[14px] border border-border-subtle p-5">
                <h4 className="font-semibold text-text-main">Workspace access</h4>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[10px] bg-surface-2 p-3">
                    <p className="text-xs text-text-muted">Your role</p>
                    <div className="mt-2"><RoleBadge role={workspace.role} /></div>
                  </div>
                  <div className="rounded-[10px] bg-surface-2 p-3">
                    <p className="text-xs text-text-muted">Members</p>
                    <p className="mt-1 text-xl font-semibold text-text-main">{loading ? "—" : members.length}</p>
                  </div>
                  <div className="rounded-[10px] bg-surface-2 p-3">
                    <p className="text-xs text-text-muted">Pending invites</p>
                    <p className="mt-1 text-xl font-semibold text-text-main">{loading ? "—" : pendingInvites.length}</p>
                  </div>
                </div>
              </section>

              {isOwner && (
                <section className="rounded-[14px] border border-red-500/20 bg-red-500/[0.03] p-5">
                  <h4 className="font-semibold text-red-600 dark:text-red-400">Danger zone</h4>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-main">Delete this workspace</p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {workspace.isDefault
                          ? "The Default workspace protects migrated data and cannot be deleted."
                          : "Permanently removes its routing configuration, members, invites, and usage data."}
                      </p>
                    </div>
                    <Button variant="danger" size="sm" icon="delete" onClick={() => setDeleteOpen(true)} disabled={workspace.isDefault}>
                      Delete workspace
                    </Button>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {canManage && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-[14px] border border-border-subtle p-4">
                    <h4 className="font-semibold text-text-main">Add existing user</h4>
                    <p className="mt-1 text-xs text-text-muted">Grant access immediately using a username or email.</p>
                    <form onSubmit={addMember} className="mt-4 space-y-3">
                      <Input
                        placeholder="Username or email"
                        icon="person_add"
                        value={memberForm.identifier}
                        onChange={(event) => setMemberForm((current) => ({ ...current, identifier: event.target.value }))}
                      />
                      {isOwner && (
                        <DailyTokenLimitInput
                          value={memberForm.dailyTokenLimit}
                          onChange={(dailyTokenLimit) => setMemberForm((current) => ({ ...current, dailyTokenLimit }))}
                        />
                      )}
                      <div className="flex gap-2">
                        <Select
                          aria-label="Existing user role"
                          options={ROLE_OPTIONS}
                          value={memberForm.role}
                          onChange={(event) => setMemberForm((current) => ({ ...current, role: event.target.value }))}
                          className="flex-1"
                        />
                        <Button type="submit" icon="add" loading={action === "add-member"} disabled={!memberForm.identifier.trim() || (isOwner && parseDailyTokenLimit(memberForm.dailyTokenLimit) === null)}>
                          Add
                        </Button>
                      </div>
                    </form>
                  </section>

                  <section className="rounded-[14px] border border-border-subtle p-4">
                    <h4 className="font-semibold text-text-main">Invite new member</h4>
                    <p className="mt-1 text-xs text-text-muted">Create a secure link that expires after seven days.</p>
                    <form onSubmit={inviteMember} className="mt-4 space-y-3">
                      <Input
                        type="email"
                        placeholder="name@company.com"
                        icon="mail"
                        value={inviteForm.email}
                        onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                      />
                      {isOwner && (
                        <DailyTokenLimitInput
                          value={inviteForm.dailyTokenLimit}
                          onChange={(dailyTokenLimit) => setInviteForm((current) => ({ ...current, dailyTokenLimit }))}
                        />
                      )}
                      <div className="flex gap-2">
                        <Select
                          aria-label="Invitation role"
                          options={ROLE_OPTIONS}
                          value={inviteForm.role}
                          onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
                          className="flex-1"
                        />
                        <Button type="submit" icon="send" loading={action === "invite"} disabled={!inviteForm.email.trim() || (isOwner && parseDailyTokenLimit(inviteForm.dailyTokenLimit) === null)}>
                          Invite
                        </Button>
                      </div>
                    </form>
                  </section>
                </div>
              )}

              {inviteLink && (
                <div className="rounded-[12px] border border-brand-500/20 bg-brand-500/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-brand-500">link</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-main">Invitation link</p>
                      <p className="mt-0.5 text-xs text-text-muted">This link is shown only now. Copy it before closing.</p>
                      <div className="mt-3 flex gap-2">
                        <input readOnly value={inviteLink} className="h-9 min-w-0 flex-1 rounded-[9px] bg-surface px-3 text-xs text-text-muted border border-border-subtle" />
                        <Button size="sm" variant="secondary" icon="content_copy" onClick={copyInvite}>Copy</Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <section className="overflow-hidden rounded-[14px] border border-border-subtle">
                <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                  <div>
                    <h4 className="font-semibold text-text-main">Members</h4>
                    <p className="text-xs text-text-muted">
                      {members.length} {members.length === 1 ? "person has" : "people have"} access
                    </p>
                  </div>
                  {loading && <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>}
                </div>
                <div className="divide-y divide-border-subtle">
                  {!loading && members.length === 0 && (
                    <div className="p-8 text-center text-sm text-text-muted">No members found</div>
                  )}
                  {members.map((member) => {
                    const isSelf = member.userId === currentUser?.id;
                    const canEdit = canManage && !isSelf && (isOwner || member.role !== "owner");
                    const roleOptions = isOwner
                      ? [...ROLE_OPTIONS, { value: "owner", label: "Owner" }]
                      : ROLE_OPTIONS;
                    return (
                      <div key={member.userId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar size="sm" name={member.displayName || member.username || member.email} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-text-main">
                                {member.displayName || member.username || member.email}
                              </p>
                              {isSelf && <Badge size="sm">You</Badge>}
                            </div>
                            <p className="truncate text-xs text-text-muted">{member.email || `@${member.username}`}</p>
                            {isOwner && member.role !== "owner" && (
                              <p className="text-xs text-text-muted">
                                Daily limit: {member.dailyTokenLimit ? `${formatDailyTokenLimitInput(member.dailyTokenLimit)} tokens` : "Unlimited"}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pl-11 sm:pl-0">
                          {canEdit ? (
                            <select
                              aria-label={`Role for ${member.displayName || member.username}`}
                              value={member.role}
                              onChange={(event) => updateRole(member, event.target.value)}
                              disabled={action === `role-${member.userId}`}
                              className="h-8 rounded-[8px] border border-border bg-surface-2 px-2 text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                            >
                              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          ) : (
                            <RoleBadge role={member.role} />
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => removeMember(member)}
                              disabled={action === `remove-${member.userId}`}
                              className="grid size-8 place-items-center rounded-[8px] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                              aria-label={`Remove ${member.displayName || member.username}`}
                            >
                              <span className="material-symbols-outlined text-[18px]">person_remove</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {canManage && pendingInvites.length > 0 && (
                <section className="overflow-hidden rounded-[14px] border border-border-subtle">
                  <div className="border-b border-border-subtle px-4 py-3">
                    <h4 className="font-semibold text-text-main">Pending invitations</h4>
                    <p className="text-xs text-text-muted">Invitations expire automatically after seven days</p>
                  </div>
                  <div className="divide-y divide-border-subtle">
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-text-muted">
                          <span className="material-symbols-outlined text-[17px]">mail</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-main">{invite.email}</p>
                          <p className="text-xs text-text-muted">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
                          {isOwner && invite.dailyTokenLimit !== null && (
                            <p className="text-xs text-text-muted">
                              Daily limit: {invite.dailyTokenLimit ? `${formatDailyTokenLimitInput(invite.dailyTokenLimit)} tokens` : "Unlimited"}
                            </p>
                          )}
                        </div>
                        <RoleBadge role={invite.role} />
                        <button
                          type="button"
                          onClick={() => revokeInvite(invite)}
                          disabled={action === `invite-${invite.id}`}
                          className="grid size-8 place-items-center rounded-[8px] text-text-muted hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                          aria-label={`Revoke invitation for ${invite.email}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteWorkspace}
        title="Delete workspace?"
        message={`“${workspace.name}” and all of its routing data will be permanently deleted. This cannot be undone.`}
        confirmText="Delete workspace"
        loading={action === "delete"}
      />
    </>
  );
}

export default function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  currentUser,
  busy,
  onSwitch,
  onWorkspacesChange,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [menuError, setMenuError] = useState("");
  const rootRef = useRef(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null,
    [workspaces, activeWorkspaceId],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [menuOpen]);

  if (!activeWorkspace) return null;

  const selectWorkspace = async (workspaceId) => {
    if (busy || workspaceId === activeWorkspaceId) return;
    setMenuOpen(false);
    setMenuError("");
    try {
      await onSwitch(workspaceId);
    } catch (err) {
      setMenuError(err.message);
      setMenuOpen(true);
    }
  };

  const createWorkspace = async (name) => {
    const data = await readResponse(await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }));
    const created = { ...data.workspace, role: "owner" };
    onWorkspacesChange((current) => [...current, created]);
    setCreateOpen(false);
    await onSwitch(created.id);
  };

  const updateWorkspace = (updated) => {
    onWorkspacesChange((current) => current.map((workspace) => workspace.id === updated.id ? { ...workspace, ...updated } : workspace));
  };

  const deleteWorkspace = async (workspaceId) => {
    const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
    onWorkspacesChange(remaining);
    if (workspaceId === activeWorkspaceId && remaining[0]) await onSwitch(remaining[0].id);
  };

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Workspace: ${activeWorkspace.name}`}
          className="group flex h-9 max-w-[220px] items-center gap-2 rounded-[10px] border border-border-subtle bg-surface/75 px-2.5 text-left shadow-sm transition-all hover:border-brand-500/30 hover:bg-surface disabled:cursor-wait disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px] text-brand-500">workspaces</span>
          <span className="hidden min-w-0 flex-1 sm:block">
            <span className="block truncate text-xs font-semibold leading-4 text-text-main">{activeWorkspace.name}</span>
            <span className="block text-[10px] capitalize leading-3 text-text-muted">{busy ? "Switching…" : activeWorkspace.role}</span>
          </span>
          <span className={`hidden material-symbols-outlined text-[17px] text-text-muted transition-transform sm:block ${menuOpen ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>

        {menuOpen && (
          <div role="menu" className="fixed left-3 right-3 top-[58px] z-50 overflow-hidden rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-elev)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[310px]">
            <div className="border-b border-border-subtle px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">Workspace</p>
              <p className="mt-1 text-xs text-text-muted">Switch routing context without mixing data.</p>
            </div>

            {menuError && <div className="mx-3 mt-3"><InlineStatus status={{ type: "error", message: menuError }} /></div>}

            <div className="max-h-64 overflow-y-auto p-2 custom-scrollbar">
              {workspaces.map((workspace) => {
                const selected = workspace.id === activeWorkspaceId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => selectWorkspace(workspace.id)}
                    className={`flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
                      selected ? "bg-brand-500/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <WorkspaceMark name={workspace.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-text-main">{workspace.name}</span>
                        {workspace.isDefault && <span className="material-symbols-outlined text-[14px] text-text-muted" title="Default workspace">home</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] capitalize text-text-muted">{workspace.role}</span>
                    </span>
                    {selected && <span className="material-symbols-outlined text-[19px] text-brand-500">check</span>}
                  </button>
                );
              })}
            </div>

            {activeWorkspace.role === "owner" && <div className="grid grid-cols-2 gap-2 border-t border-border-subtle bg-surface-2/40 p-2.5">
              {activeWorkspace.role === "owner" && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setManageOpen(true); }}
                  className="flex items-center justify-center gap-1.5 rounded-[9px] px-2 py-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[17px]">settings</span>
                  Manage
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setCreateOpen(true); }}
                className="flex items-center justify-center gap-1.5 rounded-[9px] bg-brand-500 px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
              >
                <span className="material-symbols-outlined text-[17px]">add</span>
                New workspace
              </button>
            </div>}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateWorkspaceModal isOpen onClose={() => setCreateOpen(false)} onCreate={createWorkspace} />
      )}
      {manageOpen && activeWorkspace.role === "owner" && (
        <WorkspaceManagerModal
          isOpen
          onClose={() => setManageOpen(false)}
          workspace={activeWorkspace}
          currentUser={currentUser}
          onWorkspaceUpdated={updateWorkspace}
          onWorkspaceDeleted={deleteWorkspace}
        />
      )}
    </>
  );
}

WorkspaceMark.propTypes = { size: PropTypes.oneOf(["sm", "md"]) };
RoleBadge.propTypes = { role: PropTypes.string.isRequired };
InlineStatus.propTypes = { status: PropTypes.shape({ type: PropTypes.string, message: PropTypes.string }) };
CreateWorkspaceModal.propTypes = { isOpen: PropTypes.bool, onClose: PropTypes.func, onCreate: PropTypes.func };
WorkspaceManagerModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  workspace: PropTypes.object,
  currentUser: PropTypes.object,
  onWorkspaceUpdated: PropTypes.func,
  onWorkspaceDeleted: PropTypes.func,
};
WorkspaceSwitcher.propTypes = {
  workspaces: PropTypes.arrayOf(PropTypes.object).isRequired,
  activeWorkspaceId: PropTypes.string,
  currentUser: PropTypes.object,
  busy: PropTypes.bool,
  onSwitch: PropTypes.func.isRequired,
  onWorkspacesChange: PropTypes.func.isRequired,
};
