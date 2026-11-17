export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const MIGRATED_ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";

export const WORKSPACE_ROLES = Object.freeze({
  MEMBER: "member",
  ADMIN: "admin",
  OWNER: "owner",
});

export const WORKSPACE_ROLE_ORDER = Object.freeze({
  [WORKSPACE_ROLES.MEMBER]: 1,
  [WORKSPACE_ROLES.ADMIN]: 2,
  [WORKSPACE_ROLES.OWNER]: 2,
});

export function isWorkspaceRole(role) {
  return Object.hasOwn(WORKSPACE_ROLE_ORDER, role);
}

export function hasWorkspaceRole(role, minimumRole) {
  return isWorkspaceRole(role)
    && isWorkspaceRole(minimumRole)
    && WORKSPACE_ROLE_ORDER[role] >= WORKSPACE_ROLE_ORDER[minimumRole];
}

// Both roles have the full dashboard. Admin-only roster and workspace
// lifecycle actions must use isWorkspaceAdmin instead of the dashboard tier.
export function hasFullWorkspaceDashboard(role) {
  return hasWorkspaceRole(role, WORKSPACE_ROLES.OWNER);
}

// The built-in admin has a legacy owner membership. Ordinary owner
// memberships do not grant authority over workspace membership.
export function isWorkspaceAdmin(role, userId) {
  return isWorkspaceRole(role) && (role === WORKSPACE_ROLES.ADMIN || userId === MIGRATED_ADMIN_USER_ID);
}

// Tables partitioned by workspaceId — shared by migration 002 (rebuild) and
// workspacesRepo (cascade delete). Keep in sync with schema.js TABLES.
export const ROUTING_TABLES = Object.freeze([
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "usageHistory",
  "usageDaily",
  "requestDetails",
]);
