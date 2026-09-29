"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/shared/components";

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to update model access");
  return data;
}

export default function ModelAccessPanel({ workspaceId, userId = null }) {
  const endpoint = `/api/workspaces/${workspaceId}${userId ? `/members/${userId}` : ""}/model-access`;
  const [data, setData] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("models");
  const [manual, setManual] = useState("");
  const [pageSize, setPageSize] = useState(60);

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(readResponse).then((result) => {
      if (active) { setData(result); setPolicy(result.policy); }
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [endpoint]);

  const workspaceRestricted = userId && data?.workspacePolicy.mode === "restricted";
  const canChoose = (key, id) => !workspaceRestricted || data.workspacePolicy[key].includes(id);
  const choices = useMemo(() => {
    if (!data || !policy) return [];
    const map = new Map((data.catalog[tab] || []).map((item) => [item.id, item]));
    const ids = tab === "models" ? policy.models : policy.comboIds;
    if (tab === "models") {
      for (const id of [...ids, ...data.workspacePolicy.models]) {
        if (!map.has(id)) map.set(id, { id, label: id, kind: "custom" });
      }
    } else {
      for (const id of ids) if (!map.has(id)) map.set(id, { id, name: "Deleted combo", kind: "unavailable", deleted: true });
    }
    const needle = query.trim().toLowerCase();
    return [...map.values()].filter((item) => !needle || `${item.id} ${item.label || item.name} ${item.provider || ""} ${item.kind}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)));
  }, [data, policy, tab, query]);

  const toggle = (key, id) => {
    setMessage("");
    setPolicy((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((value) => value !== id) : [...current[key], id] }));
  };
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await readResponse(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) }));
      setData((current) => ({ ...current, ...result })); setPolicy(result.policy);
      setMessage("Model access saved. Applies to new requests immediately.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const addManual = () => {
    const id = manual.trim();
    if (!id.includes("/") || /\s/.test(id)) { setError("Enter a provider/model identifier, for example openai/gpt-4o-mini."); return; }
    setPolicy((current) => ({ ...current, models: [...new Set([...current.models, id])] }));
    setManual(""); setError(""); setMessage(""); setTab("models"); setQuery("");
  };
  const title = userId ? "Member model access" : "Workspace model access";
  if (!policy) return <Card title={title} icon="tune"><p role={error ? "alert" : "status"} className="text-sm text-text-muted">{error || "Loading model access…"}</p></Card>;
  const count = policy.models.length + policy.comboIds.length;
  const dirty = JSON.stringify(policy) !== JSON.stringify(data.policy);
  const blocked = workspaceRestricted && (policy.models.some((id) => !canChoose("models", id)) || policy.comboIds.some((id) => !canChoose("comboIds", id)));

  return <Card title={title} icon="tune" subtitle={userId ? "Inherit the workspace allowance or choose a smaller list for this member." : "The common allowance for all API keys in this workspace, including Owner keys."}>
    <div className="space-y-4">
      <Select label="Access mode" aria-label={`${title} mode`} value={policy.mode} disabled={saving}
        options={[{ value: userId ? "inherit" : "all", label: userId ? "Inherit workspace" : "All configured models and combos" }, { value: "restricted", label: "Selected models and combos only" }]}
        onChange={(event) => { setPolicy((current) => ({ ...current, mode: event.target.value })); setMessage(""); }} />
      {policy.mode === "inherit" && <p className="text-sm text-text-muted">{data.workspacePolicy.mode === "all" ? "Workspace allows all configured models and combos." : `Workspace allows ${data.workspacePolicy.models.length} models and ${data.workspacePolicy.comboIds.length} combos.`}</p>}
      {policy.mode === "restricted" && <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">{policy.models.length} models · {policy.comboIds.length} combos</Badge>
          <Button type="button" variant="ghost" size="sm" disabled={saving || !count} onClick={() => setPolicy((current) => ({ ...current, models: [], comboIds: [] }))}>Clear selection</Button>
          {workspaceRestricted && <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setPolicy({ mode: "restricted", models: [...data.workspacePolicy.models], comboIds: [...data.workspacePolicy.comboIds] })}>Use workspace selection</Button>}
        </div>
        {!count && <p role="status" className="rounded-[10px] bg-amber-500/10 p-3 text-sm text-amber-600">No models selected: all generation requests will be denied.</p>}
        {blocked && <p className="text-xs text-amber-600">Some saved entries are outside the current workspace allowance and cannot be used. Uncheck them to remove them.</p>}
        <p className="text-xs text-text-muted">Combo access permits the combo route, not direct calls to its underlying models. Member access never exceeds the workspace allowance.</p>
        <div className="flex gap-2" role="group" aria-label="Model access catalog">
          {[["models", "Models"], ["combos", "Combos"]].map(([value, label]) => <Button key={value} type="button" variant={tab === value ? "primary" : "ghost"} size="sm" aria-pressed={tab === value} onClick={() => { setTab(value); setQuery(""); setPageSize(60); }}>{label}</Button>)}
        </div>
        <Input aria-label={`Search allowed ${tab}`} placeholder={`Search ${tab} by name, provider or kind`} icon="search" value={query} disabled={saving} onChange={(event) => { setQuery(event.target.value); setPageSize(60); }} />
        <div className="max-h-64 overflow-y-auto rounded-[10px] border border-border-subtle divide-y divide-border-subtle">
          {choices.slice(0, pageSize).map((item) => {
            const key = tab === "models" ? "models" : "comboIds";
            const checked = policy[key].includes(item.id);
            const allowed = canChoose(key, item.id) && !item.deleted;
            return <label key={item.id} className={`flex items-start gap-3 px-3 py-2.5 text-sm ${!allowed && !checked ? "opacity-50" : "cursor-pointer hover:bg-surface-2"}`}>
              <input type="checkbox" aria-label={`Allow ${item.label || item.name || item.id}`} className="mt-1 accent-brand-500" checked={checked} disabled={saving || (!allowed && !checked)} onChange={() => toggle(key, item.id)} />
              <span className="min-w-0 flex-1"><span className="block break-words font-medium text-text-main">{item.label || item.name}</span>
                <span className="block break-all text-xs text-text-muted">{tab === "models" ? item.id : `Combo · ${item.kind}`}{!allowed ? " · unavailable in workspace" : ""}</span></span>
              <span className="text-[11px] text-text-muted">{item.kind}</span>
            </label>;
          })}
          {!choices.length && <p className="p-5 text-center text-sm text-text-muted">{tab === "combos" ? "No matching combos. Create combos in the Combos page first." : "No matching models. Enter a custom identifier below."}</p>}
          {choices.length > pageSize && <Button type="button" variant="ghost" fullWidth onClick={() => setPageSize((size) => size + 60)}>Show more ({choices.length - pageSize})</Button>}
        </div>
        {!workspaceRestricted && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input className="flex-1" label="Custom / live model ID" aria-label="Custom model ID" placeholder="provider/model" value={manual} disabled={saving} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManual(); } }} />
          <Button type="button" variant="secondary" icon="add" disabled={saving || !manual.trim()} onClick={addManual}>Add model</Button>
        </div>}
        {tab === "models" && <p className="text-xs text-text-muted">Catalog uses local provider definitions and aliases. Selection grants permission; it does not connect a provider. Search/fetch entries use the provider field in requests.</p>}
      </>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {message && <p role="status" className="text-sm text-green-600">{message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving || !dirty} onClick={() => { setPolicy(data.policy); setError(""); setMessage(""); }}>Discard</Button>
        <Button type="button" icon="save" loading={saving} disabled={!dirty} onClick={save}>Save model access</Button>
      </div>
    </div>
  </Card>;
}
