# Member access and daily token limits

This feature is an extension layer on top of upstream 9Router. It deliberately
keeps provider routing and `open-sse/**` unchanged so upstream releases can be
merged without reapplying business rules throughout the request pipeline.

## Access matrix

| Capability | Owner | Member / Admin |
| --- | --- | --- |
| Existing 9Router dashboard and settings | Full | Hidden and server-blocked |
| Workspace member management | Yes | Admin only; member no |
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

In Workspace settings → Members, one form accepts a username or email. An
existing account joins immediately; a new email address creates an invitation
link. An unknown username needs an email address to invite. Owners can set a
daily token limit in the same form, with thousands grouped while typing (for
example, `1,250,000`). Invitation limits take effect when the invited user
accepts the link. Admins can add or invite users without setting a quota.
Invitations created before this feature keep an existing member's quota, or
give a new member the default unlimited quota. The owner can adjust the quota
later on the Members page, where the same number format is used.

## Member gifts and usage reset

An owner can grant either one-time extra tokens or usage reset passes from a
member's profile. Each grant has an exact start and end date and time, including
seconds. The browser enters local time and sends an ISO timestamp with its time
zone resolved. A gift is active when `startsAt <= now < endsAt`; unused amounts
expire at the end time. Grants of the same type stack. Active extra tokens are
charged only after the member's base daily allowance is exhausted, and the
soonest-expiring gift is spent first. Spent gift tokens are not restored by a
usage reset or the next day. A member with an unlimited base limit does not
spend gift tokens.

Reset passes are redeemed one at a time from the member dashboard while active.
The member needs positive usage counted toward the current day's limit to
redeem one. The owner also has a separate immediate reset action that does not
spend a gift pass. Either reset sets **Used today** (the quota counter) to zero
and restores the base daily allowance. **Total recorded today**, request count,
charts, and request history retain the actual usage. Token gifts already spent
stay spent. The reset marker uses both a timestamp and the last usage row ID so
requests recorded in the same millisecond are not counted again. The marker
ceases to affect the counter at the next local midnight.

The new table and reset-marker columns are added in migration 005. Gift grants
and redemptions are bound to workspace membership. Only owners can grant gifts
or perform direct resets; members can redeem only their own reset passes.

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
- `src/lib/db/migrations/005-member-gifts.js`
- `src/lib/db/repos/memberAccessRepo.js`
- `src/lib/db/repos/memberGiftsRepo.js`
- `src/lib/db/repos/memberManagementRepo.js`
- `src/lib/workspaces/memberQuota.js`
- `src/lib/workspaces/memberUsage.js`
- `src/lib/workspaces/memberPolicy.js`
- `src/app/api/member/**`
- `src/app/api/workspaces/[id]/members/[userId]/gifts/route.js`
- `src/app/api/workspaces/[id]/members/[userId]/usage-reset/route.js`
- `src/app/api/workspaces/[id]/members/[userId]/profile/route.js`
- `src/app/(dashboard)/dashboard/member/page.js`
- `src/app/(dashboard)/dashboard/members/page.js`
- `tests/unit/workspace-member-limits.test.js`
- `tests/unit/workspace-member-policy.test.js`

## Upstream merge points

Only these existing files contain small hooks for this feature:

- `src/lib/db/schema.js`: additive member columns, gift table, and indexes.
- `src/lib/db/migrations/index.js`: registers migrations 003 and 005.
- `src/lib/workspaces/requestContext.js`: centralized quota check.
- `src/lib/db/repos/usageRepo.js`: stamps the trusted context `userId` and
  spends active token gifts in the same transaction as usage history.
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
