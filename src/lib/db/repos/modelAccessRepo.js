import { makeWorkspaceKv } from "../helpers/workspaceKvStore.js";
import { getAdapter } from "../driver.js";
import { getCombos, getComboById, getComboByName } from "./combosRepo.js";
import { getModelInfo } from "@/sse/services/model.js";
import { requireWorkspaceId } from "@/lib/workspaces/requestContext.js";
import { resolveProviderId } from "@/shared/constants/providers.js";

const store = makeWorkspaceKv("modelAccess");
export const DEFAULT_WORKSPACE_ACCESS = { mode: "all", models: [], comboIds: [] };
export const DEFAULT_MEMBER_ACCESS = { mode: "inherit", models: [], comboIds: [] };

// Malformed persisted policies fail closed; absence preserves legacy behavior.
function readPolicy(value, member) {
  if (value === null) return { ...(member ? DEFAULT_MEMBER_ACCESS : DEFAULT_WORKSPACE_ACCESS) };
  const mode = value?.mode;
  if (mode === (member ? "inherit" : "all")) return { mode, models: [], comboIds: [] };
  if (mode !== "restricted" || !Array.isArray(value.models) || !Array.isArray(value.comboIds)
    || value.models.length + value.comboIds.length > 500
    || [...value.models, ...value.comboIds].some((id) => typeof id !== "string" || !id)) {
    return { mode: "restricted", models: [], comboIds: [] };
  }
  return { mode, models: value.models, comboIds: value.comboIds };
}

export async function getWorkspaceModelAccess() {
  return readPolicy(await readStoredPolicy("workspace"), false);
}

export async function getMemberModelAccess(userId) {
  return readPolicy(await readStoredPolicy(`member:${userId}`), true);
}

async function readStoredPolicy(key) {
  const db = await getAdapter();
  const row = db.get("SELECT value FROM workspaceKv WHERE workspaceId = ? AND scope = 'modelAccess' AND key = ?", [requireWorkspaceId(), key]);
  if (!row) return null;
  try { return JSON.parse(row.value) ?? {}; } catch { return {}; }
}

export async function normalizeModelAccess(value, { member = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Model access policy is required");
  if (![(member ? "inherit" : "all"), "restricted"].includes(value.mode)) throw new Error("Invalid model access mode");
  if (value.mode !== "restricted") return { mode: value.mode, models: [], comboIds: [] };
  if (!Array.isArray(value.models) || !Array.isArray(value.comboIds) || value.models.length + value.comboIds.length > 500) {
    throw new Error("Choose at most 500 models and combos");
  }
  const models = [];
  for (const name of value.models) {
    if (typeof name !== "string" || !name.trim() || name.length > 256 || /\s/.test(name)) throw new Error("Invalid model identifier");
    if (!name.includes("/") && await getComboByName(name)) throw new Error("Select combos by their ID, not as a single model");
    const info = await getModelInfo(name);
    if (!info.provider || !info.model) throw new Error(`Cannot resolve model: ${name}`);
    models.push(`${info.provider}/${info.model}`);
  }
  const comboIds = [];
  for (const id of value.comboIds) {
    if (typeof id !== "string" || id.length > 128 || !await getComboById(id)) throw new Error("Combo does not belong to this workspace or was deleted");
    comboIds.push(id);
  }
  return { mode: "restricted", models: [...new Set(models)], comboIds: [...new Set(comboIds)] };
}

export async function saveWorkspaceModelAccess(policy) {
  const normalized = await normalizeModelAccess(policy);
  await store.set(requireWorkspaceId(), "workspace", normalized);
  return normalized;
}

export async function saveMemberModelAccess(userId, policy) {
  const db = await getAdapter();
  const workspaceId = requireWorkspaceId();
  if (!db.get("SELECT 1 FROM workspaceMembers WHERE workspaceId = ? AND userId = ?", [workspaceId, userId])) throw new Error("Member not found");
  const normalized = await normalizeModelAccess(policy, { member: true });
  await store.set(workspaceId, `member:${userId}`, normalized);
  return normalized;
}

export async function getModelAccessSnapshot(userId = null) {
  const [workspace, member] = await Promise.all([getWorkspaceModelAccess(), userId ? getMemberModelAccess(userId) : DEFAULT_MEMBER_ACCESS]);
  const restricted = workspace.mode === "restricted" || member.mode === "restricted";
  const combos = restricted ? await getCombos() : [];
  const byName = new Map(combos.map((combo) => [combo.name, combo]));
  const cache = new Map();
  const ruleAllows = (rule, target) => rule.mode !== "restricted" || (target.comboId
    ? rule.comboIds.includes(target.comboId) : rule.models.includes(target.model));
  async function allows(name, service = null) {
    if (!restricted) return true;
    if (typeof name !== "string" || !name) return false;
    const cacheKey = `${service || "model"}:${name}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const combo = !name.includes("/") ? byName.get(name) : null;
    const info = combo ? null : service ? { provider: resolveProviderId(name), model: service } : await getModelInfo(name);
    const target = combo ? { comboId: combo.id } : { model: info?.provider && info?.model ? `${info.provider}/${info.model}` : null };
    const allowed = ruleAllows(workspace, target) && ruleAllows(member, target);
    cache.set(cacheKey, allowed);
    return allowed;
  }
  const base = member.mode === "restricted" ? member : workspace;
  const models = restricted ? base.models.filter((model) => ruleAllows(workspace, { model }) && ruleAllows(member, { model })) : [];
  const allowedCombos = restricted ? combos.filter((combo) => ruleAllows(workspace, { comboId: combo.id }) && ruleAllows(member, { comboId: combo.id })) : [];
  return { restricted, allows, workspace, member, summary: {
    mode: restricted ? "restricted" : "all", inheritsWorkspace: member.mode === "inherit", models,
    combos: allowedCombos.map(({ id, name, kind }) => ({ id, name, kind })),
  } };
}
