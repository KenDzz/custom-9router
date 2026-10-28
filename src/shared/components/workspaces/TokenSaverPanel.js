"use client";

import { useEffect, useState } from "react";
import { Button, Card, Select } from "@/shared/components";
import { TOKEN_SAVER_FEATURES } from "@/lib/workspaces/tokenSaverPolicy.js";

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to update Token Saver");
  return data;
}

export default function TokenSaverPanel({ workspaceId, userId = null }) {
  const endpoint = `/api/workspaces/${workspaceId}${userId ? `/members/${userId}` : ""}/token-saver`;
  return <TokenSaverEditor key={endpoint} endpoint={endpoint} userId={userId} />;
}

function TokenSaverEditor({ endpoint, userId }) {
  const [data, setData] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(readResponse).then((result) => {
      if (active) { setData(result); setPolicy(result.policy); }
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [endpoint]);

  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await readResponse(await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy),
      }));
      setData(result); setPolicy(result.policy);
      setMessage("Token Saver saved. Applies to new requests immediately.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const setAll = (value) => {
    setPolicy(Object.fromEntries(TOKEN_SAVER_FEATURES.map(({ key }) => [key, value])));
    setMessage("");
  };
  const title = userId ? "Member Token Saver" : "Workspace Token Saver";
  const dirty = policy && JSON.stringify(policy) !== JSON.stringify(data.policy);
  return <Card title={title} icon="savings" subtitle="Member overrides workspace; workspace overrides system defaults.">
    {!policy ? <p role={error ? "alert" : "status"} className="text-sm text-text-muted">{error || "Loading Token Saver…"}</p> : <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setAll(null)}>Inherit all</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setAll(true)}>Enable all</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setAll(false)}>Disable all</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOKEN_SAVER_FEATURES.map(({ key, label }) => <Select key={key} label={label} aria-label={`${title} ${label}`}
          value={policy[key] === null ? "inherit" : policy[key] ? "on" : "off"} disabled={saving}
          options={[{ value: "inherit", label: userId ? "Inherit workspace" : "Inherit system default" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]}
          hint={`Saved effective setting: ${data.effective[key] ? "On" : "Off"} (${data.sources[key]})`}
          onChange={(event) => { const value = event.target.value; setPolicy((current) => ({ ...current, [key]: value === "inherit" ? null : value === "on" })); setMessage(""); }} />)}
      </div>
      <p className="text-xs text-text-muted">Service URLs, compression levels and PXPIPE installation use system settings. A request with x-9router-token-saver: off skips all five features.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="text-sm text-green-600">{message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving || !dirty} onClick={() => { setPolicy(data.policy); setError(""); setMessage(""); }}>Discard</Button>
        <Button type="button" icon="save" loading={saving} disabled={!dirty} onClick={save}>Save Token Saver</Button>
      </div>
    </div>}
  </Card>;
}
