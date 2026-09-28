import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { makeWorkspaceKv } from "../helpers/workspaceKvStore.js";
import { requireWorkspaceId } from "@/lib/workspaces/requestContext.js";

const aliasKv = makeWorkspaceKv("modelAliases");
const customKv = makeWorkspaceKv("customModels");
const mitmKv = makeWorkspaceKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases() {
  return aliasKv.getAll(requireWorkspaceId());
}

export async function setModelAlias(alias, model) {
  await aliasKv.set(requireWorkspaceId(), alias, model);
}

export async function deleteModelAlias(alias) {
  await aliasKv.remove(requireWorkspaceId(), alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias, id, type) {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels() {
  const all = await customKv.getAll(requireWorkspaceId());
  return Object.values(all);
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name }) {
  const workspaceId = requireWorkspaceId();
  const k = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added = false;
  db.transaction(() => {
    const row = db.get(
      `SELECT 1 FROM workspaceKv WHERE workspaceId = ? AND scope = 'customModels' AND key = ?`,
      [workspaceId, k],
    );
    if (row) return;
    const value = stringifyJson({ providerAlias, id, type, name: name || id });
    db.run(
      `INSERT INTO workspaceKv(workspaceId, scope, key, value) VALUES(?, 'customModels', ?, ?)`,
      [workspaceId, k, value],
    );
    added = true;
  });
  return added;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  await customKv.remove(requireWorkspaceId(), customKey(providerAlias, id, type));
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName) {
  const workspaceId = requireWorkspaceId();
  if (toolName) {
    const value = await mitmKv.get(workspaceId, toolName);
    return value || {};
  }
  return mitmKv.getAll(workspaceId);
}

export async function setMitmAliasAll(toolName, mappings) {
  await mitmKv.set(requireWorkspaceId(), toolName, mappings || {});
}
