# Member access and daily token limits

This feature is an extension layer on top of upstream 9Router. It deliberately
keeps provider routing and `open-sse/**` unchanged so upstream releases can be
merged without reapplying business rules throughout the request pipeline.

## Access matrix

| Capability | Owner | Member / Admin |
| --- | --- | --- |
| Existing 9Router dashboard and settings | Full | Hidden and server-blocked |
| Workspace member management | Yes | No |
| View/edit member profile and reset password | Yes | No |
| Set per-member daily token limit | Yes | No |
| Set workspace/member allowed models and combos | Yes | No |
| View effective model allowance | Yes | Yes, read-only |
| Personal usage dashboard | Optional | Yes |
| Personal API-key CRUD | Yes through existing UI | Yes through member UI |
| LLM API after daily limit is reached | Unlimited | HTTP 429 until next local midnight |

`0` means unlimited. Owners are always unlimited even if a stale non-zero
value exists in the database. Daily usage counts input plus output tokens;
cached-token metadata remains visible in the normal owner usage dashboard but
is not charged a second time.

## Request flow

1. A member creates a key through `/api/member/keys`; `apiKeys.userId` binds it
   to that member and the active workspace.
2. Every `/v1`, `/v1beta`, and Codex request already enters
   `withLlmWorkspace()` in `src/lib/workspaces/requestContext.js`.
3. That single boundary resolves the key, verifies that its owner is still a
   workspace member, and reads today's actual token usage.
4. If the allowance is exhausted it returns HTTP 429 with
   `daily_token_limit_reached`; otherwise the request continues unchanged into
   upstream routing.
5. Existing usage collection calls `saveRequestUsage()`. The workspace context
   stamps `usageHistory.userId`, preserving attribution even after a key is
   deleted.
6. `memberUsage.js` collects successful JSON response `usage` when upstream
   did not call the collector (for example embeddings), without double charging
   chat responses. Responses without token usage are not estimated; media units
   such as seconds/images are not converted into tokens.

The check uses completed, provider-reported usage. A final request can exceed
the remaining allowance because its exact output size is unknown before the
provider finishes; subsequent requests are blocked immediately.

Capped members have one billable request in flight per workspace in a single
9Router process. The permit is held until streaming and pending usage writes
finish; parallel calls return `member_request_in_progress` (429, retry later).
This is not a distributed quota lock: multiple server replicas require a
shared reservation/locking implementation before deployment.

Profiles and passwords belong to the shared user account, whereas roles and
limits belong to workspace membership. An owner cannot edit identity/password
fields of an account that owns another workspace (except their own account),
preventing cross-workspace owner account takeover. Existing `admin` memberships
use the restricted member experience; only `owner` receives full access.

Migration 003 is additive and repeatable. Existing keys and matching usage are
attributed to the oldest workspace owner with unlimited usage. Workspace
export/import preserves key ownership when the user is still a member; legacy
or foreign ownership falls back to the importing owner.

## Extension-owned surfaces

- `src/lib/db/migrations/003-member-token-limits.js`
- `src/lib/db/repos/memberAccessRepo.js`
- `src/lib/db/repos/memberManagementRepo.js`
- `src/lib/workspaces/memberQuota.js`
- `src/lib/workspaces/memberUsage.js`
- `src/lib/workspaces/memberPolicy.js`
- `src/app/api/member/**`
- `src/app/api/workspaces/[id]/members/[userId]/profile/route.js`
- `src/app/(dashboard)/dashboard/member/page.js`
- `src/app/(dashboard)/dashboard/members/page.js`
- `tests/unit/workspace-member-limits.test.js`
- `tests/unit/workspace-member-policy.test.js`

## Upstream merge points

Only these existing files contain small hooks for this feature:

- `src/lib/db/schema.js`: three additive columns and two indexes.
- `src/lib/db/migrations/index.js`: registers migration 003.
- `src/lib/workspaces/requestContext.js`: centralized quota check.
- `src/lib/db/repos/usageRepo.js`: stamps the trusted context `userId`.
- `src/lib/db/repos/apiKeysRepo.js`: key ownership and optional owner filters.
- `src/dashboardGuard.js`: owner/member dashboard allow-list.
- `src/shared/components/Sidebar.js`: role-specific navigation.
- `src/shared/components/WorkspaceSwitcher.js`: owner-only management action.
- `src/shared/components/Header.js` / `HeaderMenu.js`: owner-only shutdown action.
- `src/lib/db/index.js`: preserve member key attribution on export/import.

When updating upstream, preserve these invariants rather than copying whole
files. Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/workspace-*.test.js tests/unit/db-migration-chain.test.js tests/unit/dashboard-guard.test.js
```

Then lint the changed files and test one owner plus one limited member in the
browser.

See [MODEL_ACCESS.md](MODEL_ACCESS.md) for workspace/member model allow-lists,
combo semantics, persistence and the additional upgrade regression test.
