"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, Card, Input } from "@/shared/components";
import { formatDailyTokenLimitInput } from "@/shared/utils/dailyTokenLimit";

function InviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", displayName: "", password: "", confirm: "" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setError("This invitation link is incomplete.");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/auth/invite/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Invitation unavailable");
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  const acceptInvite = async (event) => {
    event.preventDefault();
    if (!preview) return;
    if (!preview.existingUser && form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          password: form.password,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to accept invitation");
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-4">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[16px] bg-brand-500/10 text-brand-500">
            <span className="material-symbols-outlined text-[30px]">group_add</span>
          </div>
          <h1 className="text-2xl font-bold text-text-main">Join a workspace</h1>
          <p className="mt-2 text-sm text-text-muted">Continue to collaborate in 9Router.</p>
        </div>

        <Card>
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin text-[28px]">progress_activity</span>
              <p className="text-sm">Checking invitation…</p>
            </div>
          ) : !preview ? (
            <div className="py-6 text-center">
              <span className="material-symbols-outlined text-[34px] text-red-500">link_off</span>
              <h2 className="mt-3 font-semibold text-text-main">Invitation unavailable</h2>
              <p className="mt-1 text-sm text-text-muted">{error || "This link may have expired or already been used."}</p>
              <Button className="mt-5" variant="secondary" onClick={() => window.location.assign("/login")}>Go to login</Button>
            </div>
          ) : (
            <form onSubmit={acceptInvite} className="space-y-5">
              <div className="rounded-[12px] border border-border-subtle bg-surface-2/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-brand-500/10 text-brand-500">
                    <span className="material-symbols-outlined text-[21px]">workspaces</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-text-main">{preview.invite.workspaceName}</h2>
                      <Badge variant={preview.invite.role === "admin" ? "info" : "default"} size="sm">
                        {preview.invite.role === "admin" ? "Admin" : "Member"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-muted">Invited as {preview.invite.email}</p>
                    {preview.invite.dailyTokenLimit != null && (
                      <p className="mt-1 text-xs text-text-muted">
                        Daily token limit: {preview.invite.dailyTokenLimit
                          ? formatDailyTokenLimitInput(preview.invite.dailyTokenLimit)
                          : "Unlimited"}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {!preview.existingUser && (
                <>
                  <Input
                    label="Username"
                    placeholder="Choose a username"
                    value={form.username}
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    required
                    autoFocus
                  />
                  <Input
                    label="Display name"
                    placeholder="How teammates will see you"
                    value={form.displayName}
                    onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  />
                </>
              )}

              {!preview.authenticatedAsInvitee && (
                <Input
                  label={preview.existingUser ? "Current password" : "Password"}
                  type="password"
                  placeholder={preview.existingUser ? "Confirm your account password" : "Create a password"}
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  autoFocus={preview.existingUser}
                />
              )}

              {!preview.existingUser && (
                <Input
                  label="Confirm password"
                  type="password"
                  placeholder="Enter the password again"
                  value={form.confirm}
                  onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))}
                  required
                />
              )}

              {preview.authenticatedAsInvitee && (
                <div className="flex items-center gap-2 rounded-[10px] bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-300">
                  <span className="material-symbols-outlined text-[18px]">verified_user</span>
                  Signed in as the invited account
                </div>
              )}

              {error && (
                <p className="flex items-start gap-1.5 text-sm text-red-500">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                fullWidth
                icon="login"
                loading={submitting}
                disabled={(!preview.existingUser && (!form.username.trim() || !form.password || !form.confirm)) || (preview.existingUser && !preview.authenticatedAsInvitee && !form.password)}
              >
                Join {preview.invite.workspaceName}
              </Button>
            </form>
          )}
        </Card>
        <p className="mt-5 text-center text-xs text-text-muted">Invitation links expire after seven days and can only be used once.</p>
      </div>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-4">
        <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
        <div className="relative z-10 flex flex-col items-center gap-3 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[30px]">progress_activity</span>
          <p className="text-sm">Loading invitation…</p>
        </div>
      </main>
    }>
      <InviteContent />
    </Suspense>
  );
}
