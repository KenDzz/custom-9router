import { makeWorkspaceKv } from "../helpers/workspaceKvStore.js";
import { getSettings } from "./settingsRepo.js";
import { getMember } from "./workspacesRepo.js";
import { getWorkspaceContext, requireWorkspaceId } from "@/lib/workspaces/requestContext.js";
import { normalizeTokenSaverPolicy, resolveTokenSaverPolicy } from "@/lib/workspaces/tokenSaverPolicy.js";

const store = makeWorkspaceKv("tokenSaver");

async function readPolicy(key) {
  const value = await store.get(requireWorkspaceId(), key, {});
  try { return normalizeTokenSaverPolicy(value); }
  catch { return normalizeTokenSaverPolicy({}); }
}

export async function saveTokenSaverPolicy(policy, userId = null) {
  const workspaceId = requireWorkspaceId();
  if (userId && !await getMember(workspaceId, userId)) throw new Error("Member not found");
  const normalized = normalizeTokenSaverPolicy(policy);
  await store.set(workspaceId, userId ? `member:${userId}` : "workspace", normalized);
  return normalized;
}

export async function getTokenSaverSnapshot(userId = null, systemSettings = null) {
  const [system, workspace, member] = await Promise.all([
    systemSettings || getSettings(), readPolicy("workspace"),
    userId ? readPolicy(`member:${userId}`) : normalizeTokenSaverPolicy({}),
  ]);
  return { policy: userId ? member : workspace, workspacePolicy: workspace,
    ...resolveTokenSaverPolicy(system, workspace, member) };
}

// Identity comes only from the authenticated API-key/dashboard request context.
export async function getEffectiveTokenSaverSettings(systemSettings) {
  const context = getWorkspaceContext();
  if (!context) return systemSettings;
  const { effective } = await getTokenSaverSnapshot(context.userId, systemSettings);
  return { ...systemSettings, ...effective };
}
