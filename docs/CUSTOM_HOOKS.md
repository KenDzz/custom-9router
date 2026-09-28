# Custom hooks — Workspace/RBAC feature

Tracks every upstream-owned file touched by the Workspace + RBAC feature, why,
and the invariant to preserve on merge. Read this before resolving conflicts
on any file listed here, and add an entry whenever a new upstream file needs
a hook.

## Custom-owned extension files

These new files have no upstream history at the current base, reducing the
usual merge conflicts. A future upstream feature can still use the same path;
check for collisions on each upgrade rather than assuming zero merge risk:

- `src/lib/workspaces/constants.js` — role enum, `WORKSPACE_ROLE_ORDER`, deterministic Default/admin IDs, `ROUTING_TABLES`.
- `src/lib/workspaces/requestContext.js` — `AsyncLocalStorage`-based per-request workspace context; `runWithWorkspace`, `getWorkspaceContext`, `requireWorkspaceId` (fail-closed), `withDashboardWorkspace`, `withLlmWorkspace`. Also exports `enterWorkspaceForTest(context)` — test-only, calls `als.enterWith()` from a `beforeEach`/`beforeAll` hook so a whole test file shares one workspace context instead of wrapping every `it()` in `runWithWorkspace()`.
- `src/lib/auth/workspaceAuth.js` — `requireUser`, `requireWorkspaceRole`, `requireDefaultOwner`. Membership is always re-read from DB; JWT role is a cache hint only.
- `src/lib/db/repos/usersRepo.js`, `src/lib/db/repos/workspacesRepo.js` — identity/workspace/membership/invite CRUD.
- `src/lib/db/helpers/workspaceKvStore.js` — `workspaceKv` table accessor, same shape as `makeKv()` plus `workspaceId`.
- `src/lib/db/migrations/002-workspaces-rbac.js` — schema v1→v2 migration.
- `src/lib/db/migrations/003-member-token-limits.js` — additive quota, key-owner, and usage-owner migration.
- `src/lib/db/repos/memberAccessRepo.js` — trusted per-member quota and usage aggregation.
- `src/lib/db/repos/memberManagementRepo.js` — atomic owner profile/password/role/limit changes.
- `src/lib/workspaces/memberPolicy.js`, `memberQuota.js`, `memberUsage.js` — restricted member surface, streaming permit, and JSON token-usage adapter.
- `src/app/api/workspaces/**`, `src/app/api/auth/workspace/route.js`, `src/app/api/auth/invite/accept/route.js`, `src/app/api/users/me/route.js` — new route trees.
- `src/app/api/member/**`, `src/app/(dashboard)/dashboard/member/page.js`, and `src/app/(dashboard)/dashboard/members/page.js` — isolated member/owner surfaces.

## Upstream-owned files with a hook

### `src/lib/db/schema.js`
**Change:** `SCHEMA_VERSION` 1→3. Added tables `users`, `workspaces`,
`workspaceMembers`, `workspaceInvites`, `workspaceKv`, `workspaceUsageMeta`.
Added `workspaceId TEXT NOT NULL` + indexes to `providerConnections`,
`providerNodes`, `proxyPools`, `apiKeys`, `combos`, `usageHistory`,
`usageDaily`, `requestDetails`. `combos.name` unique constraint changed to
`(workspaceId, name)`; `usageDaily` primary key changed to
`(workspaceId, dateKey)`.
Migration 003 adds `workspaceMembers.dailyTokenLimit`, `apiKeys.userId`, and
`usageHistory.userId` plus their lookup indexes.
**Invariant:** a merge that adds a new column/table to any of the tables
above must keep the `workspaceId` column and its indexes intact. A merge
that adds a brand-new routing table needs a matching `workspaceId NOT NULL`
column added here — check against `ROUTING_TABLES` in
`src/lib/workspaces/constants.js`.

### `src/lib/db/migrations/index.js`
**Change:** registered `002-workspaces-rbac.js` and
`003-member-token-limits.js` after `001-initial.js`.
**Invariant:** never edit `001-initial.js` itself; new upstream migrations
must be appended after `002`, never inserted before it — `002` assumes the
v1 shape exists to rebuild from.

### `src/lib/db/migrate.js` (legacy JSON import)
**Change:** every routing-table insert now stamps the Default workspace's
`workspaceId`. Alias/custom-model/disabled-model/MITM-alias data goes to
`workspaceKv` (Default). Legacy settings password is migrated onto the
Default-workspace admin user's `passwordHash`, then stripped from the
settings JSON. Usage daily/history/details and the lifetime counter go to
Default (`workspaceUsageMeta`).
**Invariant:** this path only runs once, on first migration from the old
`db.json` shape. Any upstream change to the legacy JSON shape must be
mirrored here with the same Default-workspace stamping — do not let a new
field bypass workspace tagging.

### `src/lib/db/index.js` / `src/lib/localDb.js`
**Change:** barrel re-exports for the new repos (`usersRepo`,
`workspacesRepo`) alongside existing ones. `exportDb`/`importDb` scoped to
operate on one workspace's routing payload; never export `passwordHash`,
OIDC subject, or invite token hashes.
**Invariant:** keep export/import workspace-scoped. A merge adding a new
exported field to `exportDb`'s payload must confirm it isn't a secret and is
tagged to the correct workspace.

### `src/lib/auth/dashboardSession.js`
**Change:** `createDashboardAuthToken(claims={})` / `setDashboardAuthCookie`
now forward `{ sub, userId, activeWorkspaceId, loginMethod }` alongside the
existing `authenticated: true` flag. `getDashboardAuthSession()` returns the
full JWT payload instead of a boolean. `verifyDashboardAuthToken()` keeps
its original boolean-only contract for compatibility.
`verifyDashboardPassword(password, userId)` verifies the current user's
`users.passwordHash`; it no longer reads a global settings password.
**Invariant:** `verifyDashboardAuthToken`'s boolean contract must not change
— other call sites depend on it. New claims must be additive; never remove
`authenticated` from the signed payload. Sensitive re-auth callers must pass
the authenticated user id.

### `src/app/api/settings/database/route.js`
**Change:** full database export/import requires a real Default-workspace owner
and that user's password. CLI-token bypass is removed because global settings
and pricing are instance-wide. Operations run inside explicit Default context.
**Invariant:** never restore local/CLI bypass here; workspace management and
global configuration require attributable owner authorization.

### `src/app/api/auth/login/route.js`
**Change:** accepts `{ identifier, password }` (was password-only). Missing
`identifier` defaults to `"admin"` (the migrated single-tenant user) so old
dashboard clients keep working. On success, looks up the user's workspace
memberships and sets `activeWorkspaceId` to their default workspace (or
first membership) in the JWT.
**Invariant:** the no-identifier fallback to `"admin"` must be preserved —
it's the only thing keeping pre-workspace dashboard builds functional
against a migrated DB.

### `src/dashboardGuard.js`
**Change:** added `"/api/auth/invite/accept"` to `PUBLIC_API_PATHS`. Added
`WORKSPACE_PROTECTED_PATHS` (`/api/workspaces`, `/api/users/me`,
`/api/auth/workspace`, `/api/member`) — these always require a real dashboard JWT, never
bypassed by `requireLogin=false` or the CLI token, because RBAC actions need
a real user identity to attribute to. Changed `extractApiKey` from private
to `export`ed so `requestContext.js` can reuse it.
Member sessions are deny-by-default for dashboard pages/APIs; owners retain
the existing upstream surface while members use `/dashboard/member` and
`/api/member/**`.
**Invariant:** `WORKSPACE_PROTECTED_PATHS` must be checked before the
`requireLogin=false`/local-bypass logic, never after. A merge that adds new
member/workspace-management routes must add their prefix to this list.

### `src/lib/db/repos/connectionsRepo.js`, `nodesRepo.js`, `proxyPoolsRepo.js`, `apiKeysRepo.js`, `combosRepo.js`
**Change:** every SELECT/UPDATE/DELETE by id now filters `AND workspaceId = ?`
(closing IDOR across workspaces); every INSERT stamps `workspaceId`. Public
function signatures are unchanged — each function calls
`requireWorkspaceId()` internally rather than taking an explicit parameter,
to avoid touching 38+ call sites. `apiKeysRepo.resolveApiKey(key)` is new
(maintenance/boundary use — resolves a key to its workspace without
requiring a context, used by `withLlmWorkspace`). `connectionsRepo`'s
`cleanupProviderConnections()` is the one exception: it runs at startup
outside any request context (see `initializeApp.js`) and iterates all
workspaces' rows globally, writing back each row's own `workspaceId` — it
never needs `requireWorkspaceId()`.
`getProviderConnectionsAcrossWorkspaces()` is the other explicit maintenance
boundary: quota auto-ping enumerates rows globally, then re-enters each row's
own workspace context before refresh/update work. It must not be used by a
request handler.
API keys also carry their creating `userId`. Existing owner APIs remain
workspace-wide; member APIs always pass the optional user filter.
**Invariant:** any new by-id repo function added upstream must add
`workspaceId` to its own SQL — check for this explicitly on merge, since a
missed one is a silent cross-workspace read/write, not a crash. A repo
function called from outside a route handler (background jobs, startup
sweeps) must not call `requireWorkspaceId()` — it will throw. Route handlers
that call these repos must be wrapped in `withDashboardWorkspace` or
`withLlmWorkspace` (see `docs/CUSTOM_HOOKS.md` "Route wrapping coverage"
below) — an unwrapped route now throws
`requireWorkspaceId: no workspace context on this request` instead of
silently working, which is by design (fail closed) but means every new
route touching these repos must remember the wrapper.

### `src/lib/db/repos/aliasRepo.js`, `disabledModelsRepo.js`
**Change:** model aliases, custom models, MITM aliases, and disabled models use
`workspaceKv` with `requireWorkspaceId()`. Atomic custom-model dedupe and
model disable/enable operations include workspace in every predicate/conflict.
**Invariant:** routing KV never goes back to global `kv`; only pricing remains
global. Any new routing KV scope must use `makeWorkspaceKv()`.

### `src/lib/db/repos/usageRepo.js`, `requestDetailsRepo.js`
**Change:** usage history, daily summaries, lifetime counters, request-detail
buffers, retention, reads, and by-id lookups are workspace-scoped. Both write
APIs capture `workspaceId` synchronously before their first `await`; deferred
timers and buffer flushes carry the captured id rather than reading
`AsyncLocalStorage` later. Pending requests, recent rings, connection caches,
error state, and debounced usage events are partitioned by workspace; emitter
payloads include `{ workspaceId }`.
**Invariant:** never read workspace context inside a delayed timer/buffer flush.
Every new usage query needs a `workspaceId` predicate. Stream listeners must
filter emitter payloads and re-enter the captured context before calling repos.
`saveRequestUsage()` also captures the trusted context `userId` synchronously;
never accept usage ownership from request JSON or headers.

### `src/lib/db/driver.js`
**Change:** exports `closeAdapter()` (barrel name `closeDb`) to close and reset
the global adapter explicitly. Temp-DB tests call it before deleting their
`DATA_DIR`, avoiding locked SQLite files on Windows.
**Invariant:** reset `instance` and `initPromise` before/while closing so a later
initialization cannot return the closed adapter. Production code should not
call this during active requests.

### `src/app/api/usage/**`
**Change:** every usage/dashboard handler enters `withDashboardWorkspace`.
Read routes require `member`; mutating reset-credit action requires `admin`.
The SSE route captures context at connection time, filters usage emitter events
by `workspaceId`, and re-enters that context inside delayed listeners.
**Invariant:** new usage routes must use the same wrapper. Never call scoped
usage/request-detail repos from an unwrapped handler or delayed callback.

### Auth, OAuth, and dashboard integration hooks
**Files:** `src/app/login/page.js`, `src/shared/components/Header.js`,
`src/app/api/auth/status/route.js`, `src/app/api/auth/reset-password/route.js`,
`src/app/api/auth/oidc/callback/route.js`,
`src/app/api/oauth/[provider]/[action]/route.js`, and
`src/lib/oauth/utils/server.js`.
**Change:** password login accepts username/email, password reset/status read
the user record, OIDC resolves a durable user plus Default membership, and the
header exposes create/switch workspace. OAuth routes require workspace admin;
fixed-port callback sessions capture workspace/user and revalidate membership
before saving credentials.
**Invariant:** never put a client-supplied workspace id into an OAuth session.
The fixed-port callback must re-enter the captured workspace only after a fresh
admin membership check. Existing-account invite acceptance verifies either the
matching signed-in user or that user's current password and never resets it.

### Shared dashboard/LLM and background hooks
**Files:** `src/app/api/models/**/route.js`,
`src/app/api/translator/send/route.js`,
`src/app/api/media-providers/tts/*/voices/route.js`,
`src/app/api/v1/audio/voices/route.js`,
`src/app/api/cli-tools/antigravity-mitm/alias/route.js`,
`src/shared/services/quotaAutoPing.js`, and
`src/shared/services/initializeApp.js`.
**Change:** stateful dashboard routes use member/admin wrappers. Voice catalogs
accept either a dashboard session or LLM API-key workspace, and `/v1` forwards
the credential to its internal catalog request. Startup MITM work explicitly
uses Default; quota auto-ping enumerates all workspaces and re-enters each one.
**Invariant:** background work may enumerate globally only through an explicit
maintenance API, and must re-enter the row's own workspace before any normal
repo call. Do not make `open-sse/**` workspace-aware.

## Route wrapping coverage

Every dashboard route that reads/writes provider connections, nodes, proxy
pools, API keys, or combos must wrap its handler body in
`withDashboardWorkspace(request, minimumRole, callback)`. Every `/v1/*`,
`/v1beta/*`, and Codex LLM entry route must wrap in
`withLlmWorkspace(request, callback)`. See `src/app/api/providers/route.js`
and `src/app/api/keys/route.js` for the canonical pattern.

OAuth provider start/callback routes (`src/app/api/oauth/[provider]/[action]/route.js`)
are handled separately — they must embed `workspaceId` + `userId` into the
existing signed OAuth state and revalidate membership on callback, rather
than using the simple wrapper (the callback is a redirect from a third
party, not an authenticated dashboard fetch).

**When adding a new route that touches routing data:** wrap it.
`tests/unit/workspace-route-coverage.test.js` scans route sources and fails when
a workspace-scoped repository call is added without a dashboard/LLM boundary.

## Untouchable areas (do not modify for this feature)

- `open-sse/**` — provider-agnostic routing/translation engine. Workspace
  resolution happens at the `src/app/api/**` boundary before any open-sse
  code runs; open-sse itself stays workspace-unaware.
- `custom-server.js`.
- `open-sse/providers/registry/index.js` and other generated registry files.
- `cli/**` — independent package/version, unaffected by this feature.

## Release-merge checklist

1. Merge the upstream tag into `sync/upstream-vX.Y.Z`, not directly into `custom`.
2. Resolve each file listed above individually against its invariant —
   never blanket `git merge -X ours` / `-X theirs` on this list.
3. Re-run `cd tests && npx vitest run unit/workspace-*.test.js` plus the
   existing DB/auth/guard/usage/OAuth suites.
4. Run `npx eslint .` across the diff.
5. Only after isolation tests pass, merge `sync/upstream-vX.Y.Z` into `custom`.
6. Root app (`package.json`) and `cli/` package versions are independent —
   bump only when preparing that artifact's release, not on every merge.
7. Check migration version collisions: upstream may introduce versions 002/003
   already used by this fork. Do not simply renumber applied migrations or let
   the existing schemaVersion skip upstream changes. Reconcile the registry
   with a new forward-only bridge migration and test a copy of the deployed DB
   (including old v1/v2 snapshots) before release. Back up the data directory.

See `MEMBER_ACCESS.md` for member quota behavior and the focused regression
command. Extension separation reduces merge work; it does not guarantee that
every future upstream schema or API change is automatically compatible.
