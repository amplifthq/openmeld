# Wake Latency STR Follow-up — Dedupe And Investigation Notes (2026-07-03)

## Agent Context

- Purpose: Preserve the implementation and investigation evidence from the
  July 3 Wake latency follow-up.
- Read this when: Diagnosing the referenced dedupe or timing paths.
- Update this when: New production evidence supersedes the companion baseline.
- Do not use this for: Current architecture or a general latency runbook.
- Source of truth: Owner documents and code own current behavior; this file
  owns only the dated follow-up evidence.

Status: IMPLEMENTATION + INVESTIGATION. Companion to
`2026-07-wake-latency-baseline.md` and
`2026-07-wake-latency-optimization-groundwork.md`. Remove this file together
with its companions when a newer production baseline supersedes them.

Line numbers in this note are against the working tree after this follow-up
change. Production measurements called out below come from the July 3
multi-target cold Wake sample unless stated otherwise.

## A. `send_target_reference` member-directory dedupe

### Root cause

Three concurrent dispatches in the same Space each called the Space DO member
directory endpoint. The local journal showed `send_target_reference_ready`
durations of 1.0s / 3.8s / 10.1s, matching Space DO request queueing for three
equivalent directory reads.

The local loader is
`clients/openmeld-cli/src/local-service/dispatch/send-target-reference.ts:44`.
Before this follow-up, that function built a Space access context and then
called `spaceApi.getMemberDirectory(...)` directly on every dispatch.

### Authorization and cache-key check

The member directory response is Space-level after access is authorized:

- `services/core/src/space/transport/do/space.ts:3304` forwards
  `rpcGetMemberDirectory` to `/member-directory`.
- `services/core/src/space/transport/do/space.ts:5361` authenticates and
  authorizes the request, then calls `handleGetMemberDirectory`.
- `services/core/src/space/transport/do/space.ts:7314` calls
  `listSpaceMemberDirectoryUseCase` without passing request context,
  target profile id, or viewer identity.
- `services/core/src/space/application/space-members-service.ts:707` builds
  the member directory from the Space identity directory.
- `packages/space/src/presentation/space-member-directory.ts:66` presents the
  active Space members; there is no per-target filtering in this projection.

Therefore different target profiles in the same owner/session access scope can
share one directory load. The local cache key intentionally includes:

- base URL, to avoid crossing environments;
- `spaceId`, the data owner;
- `profileOwnerUserId`, the authenticated owner scope;
- a SHA-256 hash of the optional Space password, to avoid leaking the secret
  while preventing protected/unprotected access from sharing.

It intentionally excludes `targetProfileId`.

### Change

`clients/openmeld-cli/src/local-service/dispatch/send-target-reference.ts:117`
now routes the member directory load through process-local in-flight dedupe and
a 20s TTL cache. Concurrent requests for the same key share the same promise.
Successful loads are cached until the short TTL expires. Failed loads are not
cached because the cache is populated only from the successful `.then(...)`
path and the in-flight promise is always removed in `.finally(...)`.

The existing fail-soft behavior remains unchanged: a directory failure still
returns `status: "failed"` with empty reference lines and does not block Wake.

### Tests

`clients/openmeld-cli/tests/send-target-reference.test.ts` now covers:

- concurrent same-scope requests across different target profiles use one
  `getMemberDirectory` call;
- the 20s TTL expires and reloads;
- failed loads are not cached;
- protected Space passwords are still forwarded to the network request.

## B. RuntimeCoordinator multi-target fan-out delay

### Observed symptom

The July 3 trace showed three dispatches whose
`runtimeCoordinatorExecution.createdAtMs` values clustered around +4.4s, while
`latestAttempt.startedAt` clustered around +9.0s. Treated naively, this looks
like a 4.6s gap between execution creation and attempt start.

### Important trace-field caveat

Those two fields are not a clean execution-to-delivery stopwatch:

- `latestAttempt.startedAt` comes from
  `atsd_dispatch_attempts.started_at_ms`
  (`services/core/src/space/infrastructure/d1/space-dispatch-read-repo.ts:1095`).
- For the fresh delivery path, that field is set by
  `recordDispatchAttemptExecutionOwnership` before the `/deliver-dispatch`
  RuntimeTransport call
  (`services/core/src/dispatch/infrastructure/d1/dispatch-ledger-d1.ts:2011`).
- `runtimeCoordinatorExecution.createdAtMs` is written by RuntimeTransport
  projection helpers such as
  `buildRuntimeCoordinatorExecutionRecordFromDelivery`
  (`services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:10755`).

So the currently visible trace fields are useful for gross ordering, but they
do not isolate "execution created -> daemon received frame". A follow-up
measurement must use explicit phase logs instead of comparing these two fields
as if they were one causal span.

### Code-path decomposition

The fresh-dispatch path is:

1. Queue consumer accepts the RuntimeCoordinator head before delivery:
   `services/core/src/dispatch/application/dispatch-queue-service.ts:719`.
2. The fresh delivery phase marks the dispatch as `dispatching`:
   `services/core/src/dispatch/application/dispatch-queue-service.ts:1507`.
3. `deliverDispatchMessageToDaemon` performs source-signal read, target identity
   resolution when needed, route lookup, route compatibility checks, primary
   Binding verification, and execution-ownership recording before calling
   RuntimeTransport:
   `services/core/src/dispatch/application/dispatch-execution-service.ts:441`.
4. It sends `/deliver-dispatch` through
   `deliverRuntimeTransportDispatch`:
   `services/core/src/dispatch/application/dispatch-execution-service.ts:684`.
5. RuntimeTransportHub handles `/deliver-dispatch` by calling
   `deliverDispatch`:
   `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:4906`.
6. `deliverDispatch` validates the current lease/session, calls
   `prepareAcceptedDelivery`, writes the in-memory pending dispatch, and only
   then sends `daemon.dispatch.deliver`:
   `services/core/src/runtime-transport/application/runtime-transport-dispatch-service.ts:314`.
7. `prepareRuntimeCoordinatorAcceptedDelivery` blocks the frame on authority
   work: read head lifecycle, read/write execution token authority, link the
   head lifecycle to the execution, write run command state, and sync the
   housekeeping alarm:
   `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:4957`.
8. RuntimeTransportHub then writes delivery projections and delivery events
   after the frame-send attempt:
   `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:6838`.

### Root-cause finding

The remaining fan-out delay is not proven to be one fixed timer. The confirmed
serialization point is that all dispatches for the same owner route through the
same RuntimeTransportHub owner shard, and the frame cannot be sent until
`prepareRuntimeCoordinatorAcceptedDelivery` completes its owner-shard authority
writes. Because Cloudflare Durable Objects process events on a single-threaded
turn model, three same-owner deliveries can queue behind this critical section.

The post-frame projection writes can still slow queue completion, but they are
not the first suspect for daemon-delivery start because they happen after
`sendFrame`.

### Proposed fix path

First add temporary structured timing around the confirmed critical section:

- dispatch queue: `openmeld_dispatch_head_accept`, `openmeld_dispatch_route`,
  `openmeld_dispatch_ownership_recorded`, and `openmeld_dispatch_deliver`;
- RuntimeTransportHub `/deliver-dispatch`: total handler duration,
  `deliverDispatch` total, `prepareAcceptedDelivery` total, frame-send time,
  and post-frame projection time;
- inside `prepareRuntimeCoordinatorAcceptedDelivery`: head lifecycle read,
  token authority read/issue/write, head link write, run command state write,
  and housekeeping alarm sync.

Only after that split is measured, apply one of these targeted fixes:

- if token/head/run-state writes dominate, reduce duplicate reads or combine
  same-turn writes inside the RuntimeCoordinator authority boundary;
- if housekeeping alarm sync dominates, make the hot path use
  `queueHousekeepingAlarmSync` where correctness allows;
- if post-frame projection dominates only queue response time, move more
  evidence-only projection work behind `ctx.waitUntil`, but keep frame send and
  RuntimeCoordinator authority writes synchronous.

Do not try to parallelize same-shard authority writes blindly. The owner-shard
DO is the correctness boundary for execution tokens, head lifecycle, and run
command state.

## C. Stage G: result inbox to visible reply

### Observed symptom

`resultInbox.acceptedAt -> replySignal.createdAt` is consistently around
2.7-3.7s in the July 3 multi-target sample. This is paid after every agent
result, independent of cold local startup.

### Code-path decomposition

The visible final outcome is owned by the Space publication path:

1. `rpcApplyRuntimeCoordinatorFinalizationCommand` validates the command,
   reads the source signal, builds a dispatch finalization message, and calls
   `finalizeAcceptedDispatchResult`:
   `services/core/src/space/transport/do/space.ts:2024`.
2. The success path of `finalizeAcceptedDispatchResult` first checks for an
   existing result, resolves local-state DB and profile context, clears success
   evidence, prepares the reply, emits the reply signal, and finally marks the
   dispatch succeeded:
   `services/core/src/dispatch/application/dispatch-execution-service.ts:1190`.
3. The success branch specifically clears provider-access evidence and
   readiness impact, prepares the successful reply, emits the reply, then marks
   dispatch status succeeded:
   `services/core/src/dispatch/application/dispatch-execution-service.ts:1366`.
4. The reply publication path persists the signal, schedules outbox flush in
   `waitUntil`, and broadcasts the signal. The retired external mirror hook is
   no longer part of this path:
   `services/core/src/space/application/space-signal-service.ts:168`.
5. Space DO persistence validates/creates dispatch outbox records when needed,
   runs the signal persistence transaction, inserts thread placement, applies
   retention checks, and may emit a retention warning:
   `services/core/src/space/transport/do/space.ts:8634`.
6. After finalization returns, Space DO resolves the final visible message and
   fails closed if a `reply_published` finalization cannot be tied to a visible
   Space signal:
   `services/core/src/space/transport/do/space.ts:2091`.

### Root-cause finding

The current code explains why this stage has a stable multi-second floor: the
hot path performs more than a single reply insert. It includes D1 reads/writes,
local-state evidence cleanup, target context resolution, Space signal
persistence with retention accounting, broadcast, and final visible outcome
verification before the RuntimeCoordinator finalization returns success.

The current logs do not split that 2.7-3.7s by sub-step, so no specific
sub-step should be blamed yet.

### Proposed fix path

Add temporary structured logs inside
`rpcApplyRuntimeCoordinatorFinalizationCommand` and the ports it calls:

- `build_finalization_message`;
- `finalizeAcceptedDispatchResult.total`;
- `clear_provider_access_evidence`;
- `clear_readiness_impact`;
- `prepare_successful_reply`;
- `emitDispatchReplySignals.total`;
- `publishTextSignalUseCase.persist`;
- `persistSignalWithRetention.transaction`;
- `persistSignalWithRetention.retention`;
- `broadcastSignal`;
- `resolve_final_visible_message`;
- `mark_dispatch_succeeded`.

Then move only measured evidence-only work off the visible critical path. Safe
candidates to evaluate after timing:

- avoid redundant reads when finalization already has the reply signal id;
- defer non-visibility projections or cleanup behind `waitUntil` where the
  owner docs allow it;
- keep reply-signal persistence, final visible outcome ownership, duplicate
  final-reply blocking, and one-final-outcome validation synchronous.

The contract boundary must remain: RuntimeCoordinator finalization requests a
final outcome, but the Space publication path owns whether the visible Space
reply exists.

## D. Message details multi-target status

### Root cause

Web already rendered each target status from
`wakeContext.targets[].status`:
`clients/web/src/components/spaces/space-message-details-panel.tsx:263`.
If that field was absent, the formatter returned `Status unavailable`
(`clients/web/src/components/spaces/space-message-details-panel.tsx:314`).

The API query path was not the problem:

- Web calls `getMessageDetails` with the message id:
  `clients/web/src/query/spaces/message-details.ts:10`.
- Space DO accepts the query at
  `services/core/src/space/transport/do/space.ts:5993`.

The projection was incomplete. `projectWakeContext` only converted raw
activation target ids into targets and did not merge the existing Wake trace
waterfall items.

### Change

`readSpaceMessageDetails` now resolves the Wake source signal and reads the
Wake trace waterfall by client message id when available, otherwise by source
signal id:
`services/core/src/space/transport/do/space.ts:10742`.

`projectSpaceMessageDetails` now accepts those trace items and projects each
target's label, summary status, terminal step, reason code, and steps:
`services/core/src/space/application/space-message-details.ts:132`.

The diagnostics selector list also now includes target-specific selectors so a
multi-target message can jump directly to the per-target trace:
`services/core/src/space/application/space-message-details.ts:225`.

No schema change was required because the existing message-details target
schema already models these fields as optional.

## Contract Impact Audit

CLI/local-service change:

- External payloads and schemas are unchanged.
- Old Core + new CLI is compatible because the CLI still calls the same
  `getMemberDirectory` API.
- New Core + old CLI is compatible because no server contract changed.
- The change is local scheduling/caching only. It does not create a new
  authority for Space membership, Wake availability, Binding, execution, or
  final outcome.

Core/Web message-details change:

- HTTP shape is unchanged. The response now populates existing optional fields
  that were already part of the shared schema.
- Old Web remains compatible because it can ignore optional fields.
- New Web remains compatible with an older Core response because the formatter
  still treats a missing status as `Status unavailable`.
- The Wake trace remains diagnostic read-model data. It does not become
  execution truth.

Owner-doc check:

- `developing/architecture/agent-transport-contract.md`: no change to
  RuntimeCoordinator finalization authority, execution authority, or Wake
  availability truth.
- `developing/architecture/local-openmeld-service.md`: no change to OpenMeld Service
  lifecycle or carrier trust boundary.
- `developing/architecture/data-and-observability.md`: D1/trace data remains
  a read model, not a writer.
- `developing/architecture/shared-contracts.md`: no shared schema migration.
- `developing/product/space-collaboration.md` and `developing/clients/web.md`:
  Message details now present existing target-specific trace truth instead of
  showing unavailable status for multi-target Wake.

## Validation

Focused tests:

```text
corepack pnpm --filter openmeld exec vitest run tests/send-target-reference.test.ts
corepack pnpm --filter @openmeld/core exec vitest run src/__tests__/space-message-details.test.ts
corepack pnpm --filter openmeld-web exec vitest run src/components/spaces/space-message-details-panel.test.tsx
```

Release-readiness validation is required before publishing because the change
touches CLI/local-service carrier code:

```text
corepack pnpm run verify:release-ready
```

This gate passed after re-stamping `release/local-components.json` as an
advisory local component update.

Production acceptance retest required after the patched local component is
installed or released:

```text
one message @ three same-Space agent profiles
expected journal: all three send_target_reference_ready phases <= 2s, with no
1s / 4s / 10s staircase
```
