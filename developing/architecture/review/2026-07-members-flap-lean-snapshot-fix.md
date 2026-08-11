# 2026-07 Members Lean Snapshot Flicker Fix

## Agent Context

- Purpose: Preserve the root cause, fix, and closeout evidence for the Members
  lean-snapshot flicker.
- Read this when: Diagnosing a regression in Space member cache richness.
- Update this when: Production smoke closes or contradicts the recorded fix.
- Do not use this for: Current readiness or execution authority.
- Source of truth: Web owner documents and code own current behavior; this file
  owns the dated fix evidence.

Status: IMPLEMENTED — fix landed; production smoke closeout pending. Remove
this file once the production smoke passes and any durable cache-seed rule
lives in the owning client document.

## Summary

The remaining members-page flicker came from the Web cache seed path, not from
Core readiness broadcast or RuntimeCoordinator semantics.

`useSpaceLandingBootstrapState` keeps both `bootstrapQuery` and the on-demand
`membersQuery`. The previous `useSpaceBootstrapQueryCache` implementation wrote
`bootstrap.members` directly into `spaceQueryKeys.members(...)` every time a
bootstrap snapshot arrived. That bypassed the conservative merge path in
`member-cache.ts`.

When any bootstrap, mutation, or cache snapshot included a member list without
Wake, controller, or last-seen projection fields, the UI could temporarily
render an already Available agent in a lean form:

- badge fell back to `Checking`
- detail fell back from `Connected to Felix's MacBook Pro Codex` to `Owned by
  Felix`
- activity fell back from `Added by Felix - Seen Xm ago` to `Added by Felix`

The fix keeps the Web display cache from letting incomplete bootstrap member
items overwrite richer existing member facts.

## Evidence

1. `clients/web/src/components/spaces/use-space-landing-controller.ts` still
   reads display data from `membersQuery.data ?? bootstrapQuery.data?.members ??
   null`. Because `membersQuery` is `enabled: false`, it depends on manual
   refetches or cache seeding.
2. The old bootstrap cache seed wrote the whole bootstrap members snapshot into
   the members query cache. It did not call the conservative merge helper used
   by member mutation responses.
3. `clients/web/src/lib/spaces/member-cache.ts` already proved that
   `addMembers` mutation patches use `mergeSpaceMembersSnapshot`, so the
   mutation path was not the source of the full replacement behavior.
4. The presentation layer derives `controllerDisplayName`,
   `runtimeDeviceDisplayName`, and `lastSeenLabel` from the Space member agent
   snapshot and target catalog. When those facts disappear, row copy naturally
   falls back to the lean `Owned by Felix` form.
5. New regression tests cover both the lean incoming-item case and the lean
   bootstrap cache-seed case.

## Changes

- `clients/web/src/lib/spaces/member-cache.ts`
  - Added `applySpaceBootstrapSnapshotToCache` so bootstrap seed updates use a
    conservative merge instead of whole-snapshot replacement.
  - Extended `mergeSpaceMembersSnapshot`: when an incoming agent item lacks
    `agentWakeAvailability`, it is treated as an incomplete projection. Basic
    fields may update, but existing readiness, controller, runtime device,
    last-seen, permission mode, model selection, and working directory facts are
    preserved.
  - Incoming agent items with an explicit Wake verdict still overwrite the
    existing verdict. Old Available state must not hide explicit Offline,
    Unavailable, or Checking truth.
- `clients/web/src/components/spaces/use-space-landing-controller.ts`
  - Updated `useSpaceBootstrapQueryCache` to call
    `applySpaceBootstrapSnapshotToCache` for members.
  - Status, history, and threads still seed from bootstrap as before.
- `clients/web/src/lib/spaces/member-cache.test.ts`
  - Added regression coverage for lean incoming member items.
  - Added regression coverage for lean bootstrap cache seeds.

## Validation From The Original Fix

- `corepack pnpm exec tsc --noEmit` from `clients/web`
- `corepack pnpm --filter openmeld-web exec vitest run --config vitest.config.ts
  src/lib/spaces/member-cache.test.ts src/query/spaces/bootstrap.test.ts`

The new test that preserves existing controller and activity display facts
failed before the fix because controller, runtime, last-seen, model, and
workspace fields were replaced with `null` or `undefined`. It passed after the
fix.

## Browser Validation Limitation

The original fix started a local Web build at `http://localhost:3434/`, but that
origin did not have a production OpenMeld session and redirected to `/login`.
The authenticated production site did not include the local fix yet.

The completed proof was therefore source-level root-cause analysis plus
cache/UI red-green tests. A full visual closeout still requires either logging
into the fixed local origin or deploying the Web fix and quickly creating two
test Agent Profiles in a real Space.

## Owner-Doc Check

This fix does not change Core readiness, RuntimeCoordinator execution truth,
Space live invalidation semantics, D1 ledger authority, OpenMeld Service,
Binding, or Wake availability authority.

- `developing/clients/web.md`: compliant. Web still displays Core and Space read
  models; the cache patch only preserves richer display facts until the owning
  query refetches.
- `developing/architecture/shared-contracts.md`: compliant. No shared schema or
  live invalidation frame semantics changed.
- `developing/architecture/agent-transport-contract.md`: compliant. Wake
  readiness authority, RuntimeCoordinator execution truth, and local OpenMeld
  Service semantics did not change.

## Reviewer Follow-Up

The reviewer approved the fix body after independently rerunning typecheck and
the targeted tests, but called out two residual risks:

1. Stale explicit verdicts are still possible. The conservative merge only
   protects the `agentWakeAvailability === undefined` shape. If an old bootstrap
   cache entry carries an explicit stale `checking_connection` verdict with
   missing controller fields, it can still overwrite a current Available row.
   A complete fix would compare snapshot freshness or make bootstrap seeding
   reconcile only when the members cache is empty.
2. Merge-style bootstrap seeding can briefly retain removed members until the
   members query refetches. This is a rare short window after member removal and
   Space re-entry. Removing the window would require reconcile semantics that
   use the incoming snapshot as the member-set baseline while still preserving
   selected rich fields.

The narrower conclusion is that this fix proves and closes the lean-field
overwrite mechanism. It does not prove the exact upstream producer of every
lean or stale bootstrap snapshot without post-deploy browser validation.
