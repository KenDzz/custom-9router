import { PROVIDER_MODELS } from "@/shared/constants/models.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getModelInfo } from "@/sse/services/model.js";

// Local, credential-free catalog: configuring access never refreshes tokens
// or calls external providers. Unknown/live IDs can be entered manually.
export async function getModelAccessCatalog() {
  const [connections, custom, aliases, nodes, combos] = await Promise.all([
    getProviderConnections({ isActive: true }), getCustomModels(), getModelAliases(), getProviderNodes(), getCombos(),
  ]);
  const active = new Set(connections.map((connection) => connection.provider));
  const models = new Map();
  async function add(value, label, kind = "llm") {
    const info = await getModelInfo(value);
    if (!info.provider || !info.model) return;
    const id = `${info.provider}/${info.model}`;
    if (!models.has(id)) models.set(id, { id, label: label || id, kind, provider: nodes.find((node) => node.id === info.provider)?.name || AI_PROVIDERS[info.provider]?.name || info.provider });
  }
  for (const [alias, entries] of Object.entries(PROVIDER_MODELS)) {
    const provider = resolveProviderId(alias);
    if (active.size && !active.has(provider) && !AI_PROVIDERS[provider]?.noAuth) continue;
    for (const model of entries) await add(`${alias}/${model.id}`, model.name, model.kind || model.type || "llm");
  }
  for (const model of custom) await add(`${model.providerAlias}/${model.id}`, model.name, model.type);
  for (const alias of Object.keys(aliases)) await add(alias, `${alias} (alias)`);
  for (const [provider, info] of Object.entries(AI_PROVIDERS)) {
    if (active.size && !active.has(provider) && !info.noAuth) continue;
    if (info.searchConfig) await add(`${provider}/search`, `${info.name || provider} · Search`, "webSearch");
    if (info.fetchConfig) await add(`${provider}/fetch`, `${info.name || provider} · Fetch`, "webFetch");
  }
  return { models: [...models.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)),
    combos: combos.map(({ id, name, kind }) => ({ id, name, kind: kind || "llm" })) };
}
