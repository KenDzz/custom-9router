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
value exists in the database. Limits, usage, and token gifts are counted in
**standard tokens** (see below), not raw tokens. Raw input/output counts stay
visible in the owner usage dashboard and as "Total recorded today".

## Standard tokens

One million standard tokens equal $2 of model cost, the input price of a
mid-tier Sonnet model. Each usage row is priced with the same table as the
owner cost dashboard (`pricingRepo.getPricingForModel`: owner overrides first,
then the built-in table) and converted with
`ceil(costUsd * 1,000,000 / 2)`. The input side (non-cached input, cache reads,
cache writes) and the output side (output, reasoning) are priced separately by
calling the unchanged `calculateCostFromTokens()` with the other side zeroed, so
split input/output limits keep working and the quota always mirrors the cost
column. Consequences:

- Cache reads cost about a tenth of fresh input, so cache-heavy agent traffic
  (Claude Code, Codex) uses far less allowance than its raw token count.
- An expensive model uses more allowance per token than a cheap one (Opus
  output costs more than Sonnet output, which costs more than Haiku output).
- A model priced at zero costs 0 standard tokens.
- A model with no price falls back to raw tokens at 1x, so an unknown model is
  never free.

The charged values are stored per row in `usageHistory.quotaInputTokens` and
`quotaOutputTokens`, so later price edits do not rewrite past usage. Rows
without them (older than the migration window) count raw tokens. Migration 007
adds the columns and backfills member rows from the last 8 days. Editing or
resetting prices (`PATCH`/`DELETE /api/pricing`) is restricted to the Default
workspace owner because prices now change members' quotas.

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
7. `saveRequestUsage()` prices the row once (`usageRepo.calculateCost()`),
   stores the cost and the standard-token charge, and spends gifts from that
   charge. The member activity chart and recent list still show raw tokens.

The check uses completed, provider-reported usage. Members may run multiple
requests concurrently, including through different keys of the same account.
Each request checks the remaining allowance when it starts. Requests already
in flight finish normally and can collectively exceed the remaining allowance;
new requests are blocked once recorded usage reaches the limit. This is a soft
daily limit, not a token reservation or a strict cap on in-flight usage.

Usage totals and token gift charging are committed in one database transaction.
Gift charging reads every committed usage row for the day, even when parallel
requests finish out of timestamp order. Each member POST has a trusted request
ID stored in usage metadata so distinct requests with identical timestamps and
token counts remain distinct, while repeated writes from one request are
deduplicated. A response waits for its own pending usage writes before finishing;
it never locks other requests for the duration of its stream. Multiple replicas
must share a database for usage and gifts to remain consistent.

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
- `src/lib/db/migrations/007-quota-standard-tokens.js`
- `src/lib/workspaces/standardTokens.js`
- `src/lib/workspaces/tokenQuotas.js`
- `src/lib/db/repos/memberAccessRepo.js`
- `src/lib/db/repos/memberGiftsRepo.js`
- `src/lib/db/repos/memberManagementRepo.js`
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
- `tests/unit/member-standard-token-quota.test.js`

## Upstream merge points

Only these existing files contain small hooks for this feature:

- `src/lib/db/schema.js`: additive member columns, gift table, indexes, and
  `usageHistory.quotaInputTokens`/`quotaOutputTokens`.
- `src/lib/db/migrations/index.js`: registers migrations 003, 005, and 007.
- `src/lib/workspaces/requestContext.js`: centralized quota check.
- `src/lib/db/repos/usageRepo.js`: stamps the trusted context `userId`, stores
  cost and standard-token charge, and spends active token gifts in the same
  transaction as usage history.
- `src/app/api/pricing/route.js`: price writes are Default-owner only.
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
