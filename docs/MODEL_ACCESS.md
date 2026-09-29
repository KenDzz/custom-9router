# Workspace and member model access

Only a current **Owner** may configure access. Open **Members** to set the
workspace allowance; open a member's profile to set that member's allowance.
Model access has its own Save/Discard controls, separate from profile changes.

## Rules

- Workspace defaults to `all` for backward compatibility. `restricted` grants
  exactly the selected individual models and combos; an empty list denies all
  generation requests.
- Members default to `inherit`. Their optional `restricted` list is intersected
  with the workspace list, never an override that can broaden access.
- API keys owned by Owners also respect the workspace and their individual
  policies. Dashboard administration stays fully available to Owners.
- Model IDs are normalized through the existing router resolver, including
  aliases and compatible-provider prefixes. The saved grant refers to the
  resolved provider/model, not an alias whose target might change later.
- Combo grants use stable IDs and permit the named combo route and its current
  Owner-managed fallback/fusion models. They do not grant direct calls to leaf
  models. Renaming a combo preserves its grant; deletion and recreation does not.
- Configuration is read on every new request, including requests using existing
  keys. Already-authorized streams are not interrupted by later policy changes.
- Member dashboard exposes only the effective allowance; management endpoints
  reject Member/Admin access based on fresh database membership, not JWT claims.

## Boundary and catalogs

`withLlmWorkspace` calls `modelAccess.js` before provider handlers. Unauthorized
targets return HTTP 403 with `model_not_allowed`. JSON and multipart STT requests
are checked on the actual `model`; Gemini checks the URL target, not a body
field. Web search/fetch checks `provider || model` with the corresponding
`provider/search` or `provider/fetch` grant, matching existing handlers. Call
search/fetch with the bare provider ID (or a permitted combo name).

Restricted video creation requires JSON with an explicit `provider/model`:
the existing video proxy ignores multipart model fields and uses its default
provider, so that path is denied under a restricted policy. Generation requests
without an explicit target cannot use a default-provider fallback to bypass it.

`/v1/models`, `/v1/v1/models`, `/api/v1/models` and kind-specific catalogs are
filtered by the same effective policy. The Owner selection catalog is local
and credential-free, using existing model definitions, custom models, aliases
and combos. It does not refresh tokens or fetch external catalogs. Live/unknown
model IDs may be entered manually as `provider/model`. A grant is permission,
not a guarantee that a provider is connected or that the model is supported.

## Persistence and upstream upgrades

Policies live in existing `workspaceKv`, scope `modelAccess`, keys `workspace`
and `member:<userId>`. No schema migration or engine change is required.
Missing policies preserve old behavior; malformed persisted policies fail closed.
Removing a member removes their policy. Workspace deletion removes all policies.

Back up the SQLite data directory to retain users, memberships and policies.
Existing routing JSON export/import does **not** export access policies and does
not clear existing policies on import; importing into a new database requires
reconfiguring allowances. Restored combos must retain IDs to retain combo grants.

Custom modules: `modelAccessRepo.js`, `modelAccess.js`, `modelAccessCatalog.js`,
`modelAccessRoutes.js`, both `/api/workspaces/**/model-access` routes, and
`ModelAccessPanel.js`. Small hooks are in requestContext, member overview/pages,
and member removal. `open-sse/**`, `custom-server.js` and `cli/**` stay unchanged.

On each upstream merge, preserve the boundary hook and check every new LLM route
enters it. If routing precedence or target fields change, update the custom
target extraction and its regression tests before deployment. This isolation
reduces merge conflicts; it cannot guarantee compatibility with arbitrary future
upstream routing changes.

```bash
npx vitest run --config tests/vitest.config.js tests/unit/workspace-model-access.test.js tests/unit/workspace-route-coverage.test.js tests/unit/workspace-member-limits.test.js
```

Then verify Owner selection/save, Member read-only allowance, denied requests and
filtered discovery with existing keys in a disposable preview database.
