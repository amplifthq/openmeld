# Wake Latency Optimization — Implementation Groundwork (2026-07-03)

## Agent Context

- Purpose: Map the July 3 Wake latency evidence to bounded implementation
  levers and risks.
- Read this when: Revisiting one of those levers against the companion baseline.
- Update this when: A lever lands, is rejected, or newer evidence supersedes it.
- Do not use this for: Current transport contracts or production health.
- Source of truth: This file owns only the dated implementation analysis.

Status: GROUNDWORK / PRE-IMPLEMENTATION. No production code changed by this
document. Remove this file when the mapped levers land or are rejected, or
when a newer production baseline supersedes the companion baseline report. Companion to `2026-07-wake-latency-baseline.md` (the measurement
baseline). This file maps each OpenMeld-side optimization lever to committed code
with file:line, and gives a per-lever verdict: safe / unsafe-because-X /
owner-doc-gated. All line numbers are against committed `HEAD` (read via
`git show HEAD:<path>`), because the working tree is dirty from concurrent
sessions (see Coordination note).

Scope decision: Codex's ~61s first-spawn cold start is a controller-owned
cost and is explicitly OUT of scope here (tracked separately as the
zero-token pre-warm research). This document covers only what OpenMeld controls.

## Coordination note — concurrent worktree state (READ FIRST)

At investigation time the worktree was dirty from other concurrent sessions;
`HEAD` had advanced to `7c9c833bb`. Relevant overlaps:

- `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts`
  has **uncommitted** changes from another session, entirely in the
  route-catalog-reconciliation + readiness-invalidation region
  (hub constant block ~382-506 and methods ~9130-9304). That work adds an
  exponential backoff to route reconciliation and a 200ms coalescing window
  for readiness-invalidation bursts — i.e. it targets the **Checking-status
  broadcast storm** (the "293 broadcasts / 101.5s" issue), which is adjacent
  to but distinct from the Wake-latency levers below. Its WIP does not yet
  compile (`agentReadinessInvalidationFlushTimer` is declared `readonly` then
  reassigned).
- Consequence 1: The G-stage finalization region of the hub (~1213-2130) is
  **not** touched by that diff, so the G-stage analysis below is valid, but
  any G-stage edit must rebase onto whatever that session commits and must be
  read from a clean tree first.
- Consequence 2: The **cold Stage A** lever (first-wake dispatch-firstSeen
  latency) overlaps the readiness-invalidation area that session is actively
  rewriting. Do not duplicate; coordinate before touching that region.

## Lever 1 — Stage G: publish reply on inbox-accept, decouple finalization (root-cause fix for duplicate delivery)

### Measured symptom
- Daemon sends result over WS; `resultInbox.acceptedAt` is written fast, but
  the reply becomes visible (`replySignal.createdAt`) 1.8–5.3s later, and the
  `daemon.dispatch.accepted` **receipt** reaches the daemon only after that
  full window (3.7–9s). The receipt lag is what forced the CLI-side
  ack-pending backoff workaround (`ACK_PENDING_BACKOFF_MS = [15s,30s,60s]`,
  commit `1d7475ce3`) — a band-aid, not the root cause.

### Committed code path (the receipt waits for finalization)
1. `runtime-transport-hub.ts:1213` `handleDispatchResultFrame` — validates the
   frame, then calls `handleSubmitTaskResult(...)`.
2. `runtime-transport-dispatch-service.ts:505` `handleSubmitTaskResult`:
   - `deps.acceptDispatchResult(...)` (≈:575) → `acceptDispatchResultInboxRecord`
     writes the durable inbox record (`resultInbox.acceptedAt`). On failure it
     returns early — **this is the point at which the result is durably owned
     by the cloud.**
   - `if (deps.finalizeDurableDispatchResult) { await ... }` (≈:592) — runs the
     entire finalization chain inline; `if (!finalization.ok) return finalization`
     (≈:610) propagates a `retry_later`/failure back to the daemon.
3. `runtime-transport-hub.ts:1411` `finalizeDurableDispatchResult`:
   - `ensureRuntimeCoordinatorFinalizationCommandForAcceptedResult` (:1825) —
     D1 read of the dispatch fact, `ctx.storage.put` of the command (:1917),
     D1 audit write. **Does NOT seed a finalization retry entry.**
   - `replayRuntimeCoordinatorFinalizationCommand` (:1519) — re-reads the
     command it just wrote (:1626), reads stored outcome, runs the wake-stop
     suppression check (D1 projection read), then:
   - `spaceStub.rpcApplyRuntimeCoordinatorFinalizationCommand(command)` (:1587)
     — **cross-DO RPC to the Space DO**, where the reply signal is persisted +
     broadcast. This is the bulk of the 1.8–5.3s.
   - `writeRuntimeCoordinatorFinalizationOutcome` (:1990) — `ctx.storage.put`
     outcome, `updateDispatchResultInboxPublishState` (D1), publication
     projection (D1), and **only here** is the finalization retry entry seeded
     (`buildRuntimeCoordinatorFinalizationRetry` at :2030) — and only on the
     **failure** branch.
4. Back in `handleDispatchResultFrame`, `sendSubmitTaskResultResponseFrame`
   (≈:1400, `daemon.dispatch.accepted`) is sent with the post-finalization
   `response`.
5. CLI `frame-router.ts:260` → `acknowledgeDispatchResultOutboxRecord`
   (`dispatch-result-outbox.ts:114`) removes the outbox record (`return []`,
   :133) **only when `ok === true`**. So the outbox record is held until
   finalization completes; the ack-pending backoff decides whether a duplicate
   re-send fires in the meantime.

### Root cause
The `daemon.dispatch.accepted` receipt is gated on the full finalization
(cross-DO publish + several D1/DO-storage writes), not on durable inbox
acceptance. The daemon's real obligation ends at durable inbox acceptance;
publishing to the Space is a cloud-side concern with its own retry alarm.

### Verdict: UNSAFE as a naive reorder — durability linchpin found
A naive "ack after inbox-accept, run `finalizeDurableDispatchResult` via
`ctx.waitUntil`" is **not safe** as written, because the finalization retry
entry is seeded only inside `writeRuntimeCoordinatorFinalizationOutcome`
(:2030), i.e. only after a replay attempt produces a failed outcome. If the
inline replay never runs (DO evicted/crashes mid-`waitUntil`), the command is
durably stored but has **no retry entry and no outcome → nothing replays it →
the reply never appears.** Today's synchronous inline replay (kept alive
because the receipt awaits it) is what guarantees finalization is attempted.

### Verification addendum (2026-07-03, second pass)
- Confirmed `recordRuntimeCoordinatorFinalizationCommandCreated` (:2183) writes
  only a D1 audit event (`writeRuntimeCoordinatorExecutionEventFromParts`) — it
  does NOT seed a retry entry. The durability-linchpin finding stands.
- **Second entry point:** `resolveSubmitTaskResultWithoutPending`
  (`runtime-transport-dispatch-service.ts:654`) — the no-pending path used when
  the daemon resubmits after reconnect/DO restart — also runs
  `acceptDispatchResult` → `await finalizeDurableDispatchResult` (:703) before
  responding. The Lever 1 change must cover BOTH entry points (pending and
  no-pending); the mechanism and fix shape are identical.

### Safe change (owner-doc gated)
1. Seed a finalization retry entry at command-**create** time, inside
   `ensureRuntimeCoordinatorFinalizationCommandForAcceptedResult` right after
   the `ctx.storage.put` (:1917), so the alarm
   (`processRuntimeCoordinatorFinalizationRetryAlarm`, :8593) becomes a
   guaranteed backstop independent of the inline replay.
2. Send the daemon receipt right after `inboxAcceptance.ok`, and move
   `finalizeDurableDispatchResult` to `ctx.waitUntil`. On replay success the
   seeded retry entry is removed (existing `removeRuntimeCoordinatorFinalizationRetry`
   at :2025); on failure/no-run the alarm replays it.
3. Change the receipt semantics from "published to Space" to "durably accepted
   into inbox" — which is what the CLI outbox ack already needs.
- Gate: `developing/architecture/agent-transport-contract.md` ("Finalization
  retry orchestration … writer remains in RuntimeTransportHub. Do not create a
  second finalization writer"; "Do not casually move … finalization outcome
  writes, publication blockers"). This change touches the finalization writer
  and the daemon-facing receipt contract → **mandatory Contract Impact Audit**
  and owner-doc reasoning in the same PR. It is correct and high-value (kills
  the duplicate-delivery root cause AND removes 1.8–5.3s from the daemon
  receipt loop), but it is a careful change, not a quick one.
- This SUPERSEDES the CLI ack-pending backoff band-aid (`1d7475ce3`); keep the
  band-aid until the root-cause fix ships, then consider reverting the inflated
  first-retry.

## Lever 2 — Stage G: shave the finalization critical path (independent of Lever 1)

Sequential ops between inbox-accept and reply-visible, all before/around the
cross-DO RPC:
- `ensure…` writes the command (`ctx.storage.put`, :1917) then `replay…`
  immediately **re-reads the same command** from storage
  (`readRuntimeCoordinatorFinalizationCommandForReplay`, :1626).
  - **B1 (clean micro-win):** `finalizeDurableDispatchResult` already holds the
    command object returned by `ensure…`; pass it into a fast-path replay
    instead of re-reading it. Keep the storage read only on the alarm-retry
    entry point (`processRuntimeCoordinatorFinalizationRetry`, :8614) which has
    no in-memory command. Saves one DO-storage round trip on the hot path.
- `suppressRuntimeCoordinatorFinalizationAfterWakeStop` (:1626+) reads the
  execution projection (and possibly a wake-stop event) **on every finalize**
  purely to check "was this stopped?". On the common non-stopped path that is
  1–2 D1 reads of pure overhead.
  - **B2 (needs care):** gate the projection read on an in-memory wake-stop hint
    the hub already tracks (run command state), falling back to the D1 read when
    unsure. This is a correctness gate (fail-closed on stop), so it is NOT a
    casual change — but it is the second-largest shave after the cross-DO RPC.
- The **cross-DO RPC** (`rpcApplyRuntimeCoordinatorFinalizationCommand`, :1587)
  + the Space DO's internal publish (persist signal + broadcast + retention +
  projections in `space.ts`) is the largest single chunk. Profiling that is the
  next layer (Space-DO-side), separate from this hub-side work.

## Lever 3 — send_target_reference cold load (CLI, low-risk, clean)

### Measured symptom
`send_target_reference_ready` phase took 6.6s / 3.0s / 1.0s for the 1st/2nd/3rd
new profile in the same Space, then 0.4–0.9s steady-state.

### Committed code
- `send-target-reference.ts:27` `resolveDispatchSendTargetReference` makes **one
  network call**: `spaceApi.getMemberDirectory(...)` (:61). The 6.6→3.0→1.0s
  decay across three new profiles in one Space is the Space DO member-directory
  assembly warming up (cloud DO cold on first hit).
- It runs inside `resolveDispatchBootstrapContext`, which is `await`ed at
  `execute-dispatch-task.ts:839` **before** the local runtime/ledger context
  plan is computed. So it is on the critical path, sequential before local
  disk-based prep.
- Its output is only consumed later, as prompt reference lines
  (`parse-dispatch-task.ts:759` `buildSendTargetReferenceLines`); it is **not**
  an input to local runtime-context preparation.

### Verdict: SAFE — parallelize network vs local prep
Because the member-directory HTTP call does not feed local runtime-context prep,
the two can overlap: both must complete before agent invocation, but the network
latency can be hidden behind the local disk work instead of stacked in front of
it. Contract Impact Audit still applies (touches CLI carrier/dispatch), but
there is no cross-client contract change — same request, different sequencing.
- Secondary option (lower priority): prefetch the member directory when a
  profile is added to the Space / binding is created, with staleness handling.
  Deferred; parallelizing is the clean first win.
- Note: for a plain reply the reference set is loaded but unused; a lazy load
  gated on "does this dispatch actually need target references" is a larger
  design question, out of scope here.

## Lever 4 — daemon-stream half-open detection (CLI, low-risk, clean)

### Measured symptom (from the captured incident)
Coordinator pushed a dispatch into a half-open daemon WS at 03:38:13; the daemon
only detected the dead socket at 03:38:53 (~40s), reconnected by 03:39:16, and
the hub redelivered 1.9s later. The ~40s detection window is the whole outage.

### Committed code / root cause
- `run-socket-session.ts:455` `startKeepalivePing` sends
  `DAEMON_STREAM_KEEPALIVE_PING` every `DAEMON_STREAM_KEEPALIVE_INTERVAL_MS =
  20_000` (`strategy-constants.ts:20`). Its own comment (:456-461) states it
  **"never blocks on a response"** — a **blind PING with no PONG watchdog**. The
  hub auto-answers a `DAEMON_STREAM_KEEPALIVE_PONG = "pong"` application text
  frame, which the client **swallows in onMessage**. So the keepalive does
  nothing to detect a half-open socket.
- The only detector is the heartbeat loop: `waitForHeartbeatResponse` with
  `HEARTBEAT_RESPONSE_TIMEOUT_MS = 15_000` (`strategy-constants.ts:33`), closing
  only after `HEARTBEAT_CONSECUTIVE_FAILURES_BEFORE_CLOSE = 3`
  (`core/constants.ts:60`), spaced by the **adaptive** heartbeat interval that
  grows from `MIN_HEARTBEAT_INTERVAL_MS = 5_000` (active) toward
  `MAX_HEARTBEAT_INTERVAL_MS = 60_000` (idle). On an idle-grown connection this
  accumulates to ~40s before close — matching the incident.

### Verdict: SAFE — add a PONG watchdog to the keepalive (mirror the shipped Space-client fix)
The PONG already arrives as an observable `"pong"` text frame (currently
ignored). Track `lastKeepalivePongAtMs` in onMessage; a watchdog checks
staleness and, if no PONG within e.g. 2× the keepalive interval (~40s → tunable
down), closes the socket so the existing reconnect+redeliver path (proven ~1.9s
after reconnect) runs. This is the exact pattern already shipped for web Space
clients (the PONG-watchdog for the "blind keepalive → half-open stuck"
problem). CLI-only, availability (not latency) win, composes with warm
redelivery. Contract Impact Audit applies (CLI carrier), no cross-client
contract change.
- Also worth a UX follow-up (separate): during the disconnect window the Web
  Members panel showed "Connect — Local setup is incomplete" for a profile that
  had just replied. Transient route loss should read as "reconnecting", not
  "setup incomplete". This is Web copy, not the daemon fix.

## Lever 5 — space-action CLI heavy tail (instrumentation exists; needs a captured run)

`openmeld space action reply` hit 13.3s wall time on a first run in a new profile
workspace (0.43–0.71s steady-state). Timing instrumentation was added in
`b6541fdc5` (+ `d430e0c75`). Confirm where it emits (stderr phase lines vs a
file/journal) and capture one first-run breakdown before proposing a fix; this
lever is not yet root-caused and should stay measurement-first. Candidate heavy
phases from the code: node/module startup, base-url/auth context read, local
action-record write, gateway round trip.

## Implementation status (2026-07-03)

- **Lever 4 SHIPPED (local main, not yet released):** `911abfd61` adds a PONG
  watchdog to the daemon stream keepalive
  (`daemon-stream-keepalive.ts`, 10s deadline per PING via
  `DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS`); a missed PONG terminates the
  socket so reconnect + redelivery run immediately. Unit-tested with fake
  timers (7 tests). Interop: the hub's PONG auto-response
  (`setWebSocketAutoResponse`) shipped with the original keepalive, so every
  core that receives these PINGs already answers them.
- **Lever 3 SHIPPED (local main, not yet released):** `3df7b01c4` makes the
  member-directory load run concurrently with local runtime preparation;
  awaited at its first real consumer (space-action context). The
  `send_target_reference_ready` journal phase now fires at actual resolve
  time, so it may appear after `runtime_context_ready` — the journal is a
  diagnostic stream ordered by timestamp, not a state machine.
- Validation: touched files typecheck clean and pass Biome; keepalive +
  dispatch-related suites green (59 tests); full CLI suite green except
  `prepare-step-diagnostics.test.ts`, which is a concurrent session's
  in-flight WIP (its src and test are dirty in the worktree and failures
  mutate between runs) — unrelated to these levers.
- Release gate reminder: both commits touch OpenMeld Service carrier files —
  run `pnpm run verify:release-ready` before the next CLI release/deploy.
- **Levers 1+2 SHIPPED (local main, not yet released):** `e6e5c940b` (authored
  in an isolated worktree while the concurrent readiness work occupied the
  hub, cherry-picked into main in a clean window with zero conflicts). The
  daemon receipt now goes out on durable acceptance — result in the inbox,
  finalization command persisted, retry entry seeded at command-create time —
  and the Space publish replays inside `ctx.waitUntil`, with the retry alarm
  as the eviction backstop. The replay takes the in-memory command on the hot
  path (Lever 2). Two prior timing-anchored contract tests moved their
  terminal asserts after the waitUntil flush; one new test proves the receipt
  is sent while the publish is held open, the backstop entry exists, the
  replay adds no command re-read, and publish success clears the backstop.
  `agent-transport-contract.md` records the receipt semantics in the same
  commit. Floor: core typecheck + Biome + full `test:full` green on the
  stacked main. Supersedes the `1d7475ce3` ack-wait rationale (keep the
  longer backoff anyway; re-sends should now be rare instead of paced).
- Lever 5 remains measurement-first (capture a slow space-action run via the
  `b6541fdc5` instrumentation before proposing a fix).

## Lever 1+2 detailed cut (refined 2026-07-03, ready to execute once the hub is clean)

Smaller knife than the original three-step proposal: the entire change locks
into `finalizeDurableDispatchResult` (hub) plus one seed inside `ensure…`.
`handleSubmitTaskResult` and both of its entry points need **no** changes,
because the split happens inside the dependency they already await.

Two-phase `finalizeDurableDispatchResult`:

- **Phase (a) — synchronous, before the daemon receipt** (milliseconds, DO
  storage only): `ensureRuntimeCoordinatorFinalizationCommandForAcceptedResult`
  (existing: storage.put command + D1 audit) **plus NEW: seed the finalization
  retry entry** (`buildRuntimeCoordinatorFinalizationRetry` with
  `nextReplayAtMs = now + RUNTIME_COORDINATOR_FINALIZATION_RETRY_DELAY_MS`,
  then `upsert…` + `queueHousekeepingAlarmSync`). Once (a) succeeds, return
  `{ ok: true }` — the daemon receipt goes out and the CLI outbox record is
  released. Any (a) failure keeps today's `retry_later` semantics (daemon
  re-sends), unchanged.
- **Phase (b) — `ctx.waitUntil`, after the receipt**: the existing
  `replayRuntimeCoordinatorFinalizationCommand` (wake-stop suppression check,
  cross-DO `rpcApplyRuntimeCoordinatorFinalizationCommand`, outcome write).
  Success already removes the retry entry (writeOutcome ok-branch and
  storedOutcome fast path); failure already reschedules (+5s) or exhausts to a
  publication blocker. If (b) never runs (DO evicted), the entry seeded in (a)
  makes the finalization retry alarm the guaranteed backstop — this is the
  durability linchpin the naive reorder missed.
- **Lever 2 rides along**: pass the in-memory command from `ensure…` straight
  into the (b) replay call (new optional parameter or a private fast-path),
  skipping `readRuntimeCoordinatorFinalizationCommandForReplay`'s storage
  re-read. The alarm retry entry point keeps the storage read (it has no
  in-memory command).

Why this respects the contract: the finalization writer stays
`RuntimeTransportHub` (only the trigger timing moves); RuntimeCoordinator
still decides the final outcome in one state machine; one Space outcome.
Receipt semantics change from "published to Space" to "durably accepted by
the cloud (command + retry entry persisted)" — add that sentence to
`agent-transport-contract.md` in the same PR.

Observability check: `latestAttempt.finishedAt` and the reply-signal
timestamps are written on the replay/outcome path, not the receipt path, so
trace waterfalls keep their meaning; the daemon journal's `result.accepted`
event simply arrives seconds earlier.

Test plan:
1. NEW: command-create seeds a retry entry (assert entry exists after (a)).
2. NEW: `finalizeDurableDispatchResult` resolves ok without the Space publish
   completing (hang the space stub; receipt path must not block).
3. Existing/confirm: replay success removes the retry entry; (a) failure
   (e.g. missing dispatch fact) still returns `retry_later`.
4. Floor: full core `test:boundary` + `test:workers`.

Expected effect: removes the 1.4–5.2s cross-DO publish from the daemon
receipt loop (kills the duplicate-delivery root cause properly, superseding
the `1d7475ce3` ack-backoff band-aid) — note the reply-visible latency itself
moves only by the Lever-2 storage-read shave; the big G-stage visible-latency
win remains the Space-DO-side publish path, out of scope here.

Gate status at refinement time: the concurrent session was actively editing
the hub (mtime minutes old, zero new commits), still in the readiness-storm
scope (route-catalog notify narrowing + extracted
`agent-readiness-invalidation-service.ts` + daemon schema + rpc/methods), not
touching finalization. Blocked on: same-file uncommitted co-edits cannot be
split into clean commits. Execute when `git status` shows the hub clean.

## Suggested sequencing (all gated on a clean tree + the concurrent hub commit landing)

1. **Lever 4** (daemon PONG watchdog) — smallest, safest, availability win,
   isolated CLI file. Good first commit.
2. **Lever 3** (parallelize send_target_reference) — small, safe, CLI-only.
3. **Lever 1** (receipt-on-inbox-accept + seed retry at command-create) —
   highest value, owner-doc gated, needs Contract Impact Audit; do after the
   concurrent hub work lands to avoid a merge fight in the same file.
4. **Lever 2** (B1 in-memory command fast path) — small, can ride with Lever 1.
5. **Lever 5** — capture-first, then decide.

Every one of these touches CLI carrier files, Service contracts, or the
finalization writer → each needs the Contract Impact Audit from
`developing/engineering/development-workflow.md` and, for Lever 1, an owner-doc
update to `agent-transport-contract.md` in the same PR.
