# OpenMeld Round-3 Simplification Survey

## Agent Context

- Purpose: Preserve the dated evidence and candidate list from the Round-3
  simplification survey.
- Read this when: Triaging those candidates or checking why one was deferred.
- Update this when: Candidates are accepted, rejected, or invalidated by drift.
- Do not use this for: Current architecture or an implementation roadmap.
- Source of truth: Owner documents and code own current behavior; this file
  owns only the dated survey evidence.

Date: 2026-07-02
Branch inspected: `main`
Mode: read-only survey. This report is the only artifact.
Status: RESEARCH SNAPSHOT — Round-3 simplification work is not scheduled.
Remove this file when Round-3 items are accepted into tickets or explicitly
rejected, or when the surveyed code has drifted enough that the line anchors
are stale.

## Executive Summary

The highest-confidence conclusion is negative: most high-risk layers are not
safe deletion targets yet. Round-2 made several compensation paths smaller, but
the post-closeout production window is still too small to justify structural
cuts from production data alone. The best Round-3 plan is therefore a short
sequence: remove small verified dead surfaces, add queryable timing evidence
where Server-Timing currently cannot be aggregated, then run narrow spikes for
timer and Queue shape.

Top recommendations by expected user-visible gain divided by risk:

| Rank | Recommendation | Class | Confidence | Expected gain | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Make dispatch and bootstrap timing queryable in Analytics Engine before cutting behavior | B | High | Unlocks safe removal and parallelization decisions for Wake and loading | Low |
| 2 | Investigate Gateway's two serial auth RPCs as one authenticated-profile RPC or a tiny request-scoped cache | B/C | Medium-high | Likely removes one auth-worker RPC from most authenticated API calls, about 20-80 ms/request if the prior estimate holds | Medium |
| 3 | Use the new dispatch Server-Timing logs to decide whether `emitDispatchingActivitySignal` can leave the inline dispatch path | B | Medium | Could remove a critical-path write during Wake dispatch | Medium |
| 4 | Treat controller warm-pool / persistent app-server as a design spike, not a deletion | D | Medium | Potentially removes 1-4 s cold-start cost per Wake for supported controllers | High |
| 5 | Split CLI carrier liveness heartbeat from slow evidence reconciliation in a spike | C/D | Medium | Fewer timer concepts, less heartbeat tail work, faster catalog/report convergence | Medium-high |
| 6 | Reduce front-end bounded readiness refresh windows only after invalidation SLA data exists | B | Medium | Less client churn and faster-looking convergence without local recomputation | Medium |
| 7 | Delete the no-op mention-failure hint port | A | High | Small code and test surface removal with no product behavior change | Low |
| 8 | Remove the unused `expectedProfileIdsKey` field from the RuntimeTransportHub reconciliation cache | A | High | Tiny removal, less misleading cache semantics | Low |
| 9 | Delete stale live-badge presentation helpers | A | Medium-high | Small Web cleanup, removes old presentation vocabulary | Low |
| 10 | Run a Queue bypass spike only after collecting dispatch latency distribution | C | Medium | Could reduce dispatch conveyor complexity, but not proven safe | High |

Do not treat these as Round-3 deletion targets: fail-closed checks, Core-owned
readiness, ServiceRuntime liveness, owner docs, Gateway as a layer, diagnostics,
or Queue as the reliable conveyor. The current evidence supports changing
implementation details around those surfaces, not removing the responsibilities.

## Evidence Base

Read before surveying:

- `AGENTS.md`, especially the transport contract and invariant sections:
  `AGENTS.md:14-35`, `AGENTS.md:68-98`, `AGENTS.md:124-151`.
- Owner docs:
  `developing/architecture/agent-transport-contract.md:41-64`,
  `developing/architecture/agent-transport-contract.md:383-438`,
  `developing/architecture/agent-transport-contract.md:717-732`,
  `developing/architecture/local-openmeld-service.md:56-78`,
  `developing/architecture/local-openmeld-service.md:364-399`,
  `developing/architecture/shared-contracts.md:76-128`,
  `developing/architecture/data-and-observability.md:39-98`.
- Round-2 closeout: the Round-2 availability report was fully closed out
  (implemented, deployed, released 2026-07-02) and retired to git history.
  Recover it with
  `git log --diff-filter=D -- developing/architecture/review/2026-07-availability-round2-report.md`.

Production data checked:

- Cloudflare account id from Round-2 closeout: `c511849a74548b7f9be7e3a280afeb8f`.
- Final Round-2 Core deploy recorded in the closeout: `2026-07-02T12:58:22Z`.
- Query time during this survey: `2026-07-02T13:39:31Z`.
- `corepack pnpm ops:cf:query --since 4h --search core.openmeld.dispatch --limit 80`
  returned three queue dispatch samples in the last four hours, but only one is
  after the final Core deploy:
  - `2026-07-02 13:12:57` `queue_message_started`
  - `2026-07-02 13:12:57` `queue_batch_started`
  - `2026-07-02 13:13:03` `queue_batch_succeeded`, `durationMs=5946`
  - `2026-07-02 13:13:35` `final_visible_outcome_observed`
- `corepack pnpm ops:cf:query --since 4h --search core.openMeldDaemon.dispatch_queue.server_timing --limit 20`
  returned no rows. The dispatch segment timing exists in structured logs, but
  this checked-in Analytics query path does not expose it yet.

Interpretation: post-closeout production evidence is N=1 for the current final
deploy. It is enough to prove instrumentation is wired for queue/final-outcome
runtime evidence. It is not enough to justify deleting checks, removing Queue,
or collapsing client convergence behavior. Recheck after at least
`2026-07-03T12:58:22Z`, or sooner only if there are at least 100 post-closeout
Wake dispatches and at least 100 bootstrap loads.

## Classification Key

- A: evidence is sufficient for an immediate safe removal.
- B: needs production data before deletion or simplification.
- C: needs a spike or prototype before deciding.
- D: long-term architecture or product direction only.

## Findings

### 1. Front-end readiness polling and compensation

Classification: B, with a few A-sized cleanup candidates.

Risk: medium. These paths are not readiness authority, but they are visible
convergence behavior and can affect whether users see Checking, Offline, or a
repair action at the right time.

Current state:

- Readiness invalidation is now app-wide browser-local infrastructure:
  `clients/web/src/lib/agents/agent-readiness-invalidation-bus.ts:14-40`
  publishes only `agent.readiness.invalidated`, and
  `clients/web/src/components/app/app-shell.tsx:57-99` coalesces profile ids
  for 500 ms before calling shared cache refresh.
- The shared refresh path still re-reads owner projections:
  `clients/web/src/query/agents/execution-readiness.ts:46-74` defines batch
  readiness keys, `clients/web/src/query/agents/execution-readiness.ts:91-130`
  can notify Core and invalidate caches, and
  `clients/web/src/query/agents/execution-readiness.ts:138-181` invalidates
  active batch readiness plus optional local runtime caches.
- Remaining timers are explicit constants:
  `clients/web/src/strategy-constants.ts:1-19` defines the 2 s route refresh,
  2 s reply-readiness refresh, 5 s local runtime catalog reconcile delay, 15 s
  Space Wake refresh window, 60 s freshness refresh, and 20 s wake display
  debounce.
- The Agents page still has a bounded transition refresh:
  `clients/web/src/components/agents/agents-page-agent-profile-helpers.ts:1-33`
  calculates exponential 2/4/8/16/30 s delays, while
  `clients/web/src/components/agents/agents-page-agent-profiles-card.tsx:180-250`
  drives transition attempts for up to five minutes and performs one
  route-catalog sync per transition.
- Space landing still has distinct recovery/finality timers:
  `clients/web/src/components/spaces/space-landing.tsx:508-521` starts local
  recovery refresh, `clients/web/src/components/spaces/space-landing.tsx:733-748`
  runs a 2 s high-frequency loop while needed, and
  `clients/web/src/components/spaces/space-landing.tsx:760-778` keeps a 60 s
  slow freshness refresh.
- Wake progress polling is not readiness compensation:
  `clients/web/src/components/spaces/use-space-landing-controller.ts:1967-2095`
  polls a concrete Wake execution result, and
  `clients/web/src/components/spaces/use-space-landing-controller-helpers.ts:333-385`
  uses 1/2/5/10 s delays for that concrete dispatch result. Do not delete it as
  part of readiness simplification.
- The visual-only wake badge debounce is isolated:
  `clients/web/src/components/spaces/use-wake-display-debounce.ts:6-18` says it
  does not affect dispatch, buttons, recovery, or diagnostics, and
  `clients/web/src/components/spaces/use-wake-display-debounce.ts:43-176`
  applies only visual state.
- Member-cache synthetic Checking still exists:
  `clients/web/src/lib/spaces/member-cache.ts:15-23` documents the bootstrap
  race, and `clients/web/src/lib/spaces/member-cache.ts:140-176` synthesizes a
  pending Wake readiness availability for newly bound local profiles.

Consumers:

- App shell readiness cache refresh.
- Agents page readiness display and action state.
- Space landing Wake badge, recovery state, and current-member facts.
- Space member cache presentation.
- Concrete Wake progress polling.

Delete/simplify safety:

- Safe principle: live invalidation frames are refresh signals, not state.
  Owner docs require clients to re-read Core/Space snapshots after invalidation:
  `developing/architecture/shared-contracts.md:76-128` and
  `developing/architecture/agent-transport-contract.md:419-438`.
- Do not remove bounded refresh loops until production data proves missed-frame
  recovery and transition convergence are good enough. A missed BroadcastChannel
  frame must remain recoverable by a later snapshot or read.
- Candidate immediate cleanup: remove `useWakeDisplayDebounce` only if UX accepts
  that the badge can leave Available immediately during short route churn. This
  is authority-safe, but not product-invisible.
- Candidate later cleanup: reduce the Agents page five-minute transition budget
  after measuring create-to-Available and route-catalog invalidation convergence.
- Keep Wake progress polling because it follows dispatch-result truth, not
  readiness availability.

Benefit estimate:

- Deleting visual debounce: about one hook plus tests, roughly 150-200 Web LOC.
- Reducing client transition windows: fewer Web queries during setup/profile
  transitions; exact request savings need production profile-transition counts.
- Removing synthetic member Checking too early risks worse setup UX, so no
  immediate latency claim.

Required data and thresholds:

- Measure time from `agent.readiness.invalidated` to refreshed readiness display
  for at least 100 invalidations. Candidate threshold: p95 under 2 s and missed
  invalidation recovery by the next snapshot/read.
- Measure new local profile create/add-to-Available dwell for at least 50 setup
  flows. Candidate threshold: p95 under 10 s before reducing the five-minute
  transition window.
- Browser smoke: hidden tab, refocus, BroadcastChannel unavailable/fallback
  event, and navigation between Spaces.

Dependencies:

- Depends on queryable invalidation/convergence telemetry.
- Can remove stale live-badge helpers independently; see Finding 9.

### 2. CLI timer surface

Classification: C/D.

Risk: medium-high. The timers are noisy, but they sit inside the local OpenMeld
Service carrier and affect liveness, route catalog evidence, controller reports,
 outbox flushing, and local-control convergence.

Current state:

- Shared heartbeat policy is adaptive:
  `runtime/local-service/src/heartbeat-policy.ts:3-9` defines bounds and
  `runtime/local-service/src/heartbeat-policy.ts:33-52` resolves the adaptive
  heartbeat interval.
- Catalog sync is derived from heartbeat:
  `runtime/local-service/src/heartbeat-policy.ts:77-85` computes catalog sync as
  three heartbeats clamped between 15 s and 45 s.
- CLI constants define independent timing concepts:
  `clients/openmeld-cli/src/strategy-constants.ts:14-33` includes heartbeat
  5-60 s, WebSocket keepalive 20 s, catalog sync multiplier/min/max, catalog
  signal polling 1 s, runtime controller report 5 min, provider conversation
  proof 5 min, retry 60 s, state persistence 60 s, connect timeout 15 s, and
  request timeouts.
- The socket session holds all timer state together:
  `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts:252-273`
  defines heartbeat, keepalive, catalog signal, catalog sync, provider proof,
  and controller report timing state.
- Keepalive is independent and carries no readiness truth:
  `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts:454-471`.
- Heartbeat sends liveness evidence, flushes local outbox, adapts interval, then
  starts catalog/report/proof work from the heartbeat tail:
  `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts:573-680` and
  `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts:1263-1278`.
- Catalog signal polling remains file-based:
  `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts:760-814`,
  with signal-file helpers in
  `clients/openmeld-cli/src/local-service/state/catalog-sync-signal.ts:21-81`.
- Control-plane notification falls back to the signal file:
  `clients/openmeld-cli/src/local-service/state/route-catalog-sync-notifier.ts:17-58`.
- Runtime controller reports and provider conversation proof are separate slow
  evidence loops:
  `clients/openmeld-cli/src/local-service/reporting/runtime-agent-controller-report-sync.ts:27-70`
  and
  `clients/openmeld-cli/src/local-service/reporting/provider-conversation-proof-sync.ts:32-155`.

Consumers:

- RuntimeTransportHub heartbeat and ServiceRuntime liveness.
- Route catalog reconciliation and Web local-agent control refresh.
- Dispatch result outbox flushing.
- Runtime agent controller reports.
- Codex provider conversation proof reporting.
- Local persistent runtime state.

Delete/simplify safety:

- Do not collapse everything into one timer by deletion. Heartbeat is carrier
  liveness; reports/proofs/catalog are evidence reconciliation. Owner docs keep
  ServiceRuntime liveness separate from readiness and diagnostics:
  `developing/architecture/local-openmeld-service.md:364-399`.
- A safe spike is to split the implementation into two named loops:
  carrier heartbeat and slow evidence reconciliation. The heartbeat should stay
  focused on liveness/outbox, while the evidence loop owns catalog sync,
  controller reports, and conversation proof.
- Keep WebSocket keepalive unless transport evidence shows the connection stays
  healthy without it. It is a socket-level idle prevention mechanism, not a
  readiness duplicate.
- Keep signal-file polling until control-plane route-catalog notification has
  a supported always-on replacement for all lanes.

Benefit estimate:

- Concept count can drop from about six timer families to two owner concepts.
- Catalog/report/proof work can stop being hidden behind heartbeat tail latency.
- No credible ms estimate without local daemon profiling. Expected user-visible
  benefit is faster setup/profile checking convergence when catalog/report work
  is triggered directly.

Spike plan:

1. Add logging around heartbeat duration, catalog sync duration, controller
   report duration, provider proof duration, and signal-file wakeups in a dev
   lane.
2. Refactor in a throwaway branch to two loops without behavior changes.
3. Run fresh `OPENMELD_HOME` service lifecycle tests plus a local Web setup smoke.
4. If it touches CLI or service carrier files in implementation, later work must
   run `pnpm run verify:release-ready` and the Contract Impact Audit.

Dependencies:

- Should happen after or alongside clearer local-service diagnostics.
- Independent of Queue and Gateway work.

### 3. Internal representation layers for Wake availability

Classification: D.

Risk: high if implemented as deletion. Medium if implemented as naming and
projection cleanup only.

Current state:

- The public availability category is explicit and small:
  `packages/agent-runtime/src/agent-wake-availability.ts:9-32` defines
  `available`, `checking`, `offline`, and `unavailable`, plus phases and status.
- Route registration is a distinct fact:
  `packages/agent-runtime/src/agent-wake-availability.ts:34-50`.
- The readiness input model intentionally consumes multiple owner facts:
  `packages/agent-runtime/src/agent-execution-status.ts:111-123` includes
  binding, claim diagnostics, local service, profile, provider, route,
  runtime readiness, and service evidence.
- Core exposes several projections at once:
  `services/core/src/agent-execution/application/agent-execution-readiness-service.ts:67-82`
  returns `agentExecutionReadiness`, `primaryBinding`,
  `daemonRouteObservation`, `agentWakeRouteRegistration`, `wakeRouteStatus`,
  route device/lane fields, and space-member readiness.
- Current local runtime reply readiness is a different product question:
  `services/core/src/start/application/current-device-target-service.ts:709-716`
  says "Can this computer reply" is ServiceRuntime heartbeat-freshness, not a
  Binding fact.
- Web maps local runtime reply readiness separately:
  `clients/web/src/lib/connect/current-local-runtime-readiness.ts:4-124`.

Consumers:

- Core readiness HTTP and batch readiness.
- Space member presentation.
- Web setup/checking surfaces.
- CLI/diagnostics that need route, binding, service, and provider reasons.

Delete/simplify safety:

- Do not collapse route, ServiceRuntime liveness, Binding, provider access, and
  final readiness into one internal fact. Owner docs state user-facing Wake
  availability must come from Core-owned `AgentExecutionReadiness`, not route
  online, Binding existence, service health, or Prepare evidence alone:
  `AGENTS.md:124-151`.
- Safe simplification is naming and structure, not authority deletion:
  use internal fact names that answer one question each:
  route evidence, service liveness, binding target, provider capability, final
  Wake availability.
- Avoid adding new synonyms such as `availability`, `readiness`, and
  `wakeability` for the same projection.

Benefit estimate:

- Conceptual simplification: reduce visible internal nouns in docs/code paths
  from about six overlapping words to four owner facts plus one final
  projection.
- Runtime latency benefit is indirect only.

Dependencies:

- Should follow focused owner-doc wording changes and move-only refactors.
- Should not be bundled with behavior changes.

### 4. Queue layer removal research

Classification: C.

Risk: high. Queue is not execution authority, but it is still the reliable
dispatch conveyor and backpressure boundary.

Current state:

- Core queue binding is configured with `max_batch_timeout=0`,
  `max_batch_size=20`, and `max_retries=3`:
  `services/core/wrangler.jsonc:99-113` for local and
  `services/core/wrangler.jsonc:223-237` for production.
- Worker queue entrypoint forwards to the dispatch consumer:
  `services/core/src/index.ts:1275-1280`.
- Queue consumer emits runtime evidence for batch start/success/failure:
  `services/core/src/dispatch/transport/queue/dispatch-queue-consumer.ts:15-49`
  and
  `services/core/src/dispatch/transport/queue/dispatch-queue-consumer.ts:83-91`.
- Signal and dispatch outbox records are persisted in the Space DO transaction:
  `services/core/src/space/transport/do/space.ts:8520-8547` and
  `services/core/src/space/transport/do/space.ts:8614-8639`.
- Space outbox redrive is already alarm-backed:
  `services/core/src/space/transport/do/space.ts:563-572` defines queue attempt
  and redrive timing, `services/core/src/space/transport/do/space.ts:1724-1735`
  runs alarm redrive, and
  `services/core/src/space/transport/do/space.ts:9173-9303` flushes pending
  outbox queue entries.
- Enqueue currently retries and marks queue state:
  `services/core/src/space/transport/do/space.ts:9112-9170`.
- Owner docs define Queue as conveyor, not authority:
  `developing/architecture/agent-transport-contract.md:41-64`.

Consumers:

- Space DO outbox queue state.
- Cloudflare Queue consumer.
- Dispatch ledger and final-visible outcome evidence.
- RuntimeTransportHub delivery path.
- Redrive and retry semantics.

Delete/simplify safety:

- Do not remove Queue directly. A direct Space DO alarm-to-Hub RPC path would
  replace Queue's isolation, retry, backpressure, and worker-level batching with
  Space DO alarm behavior. That is a structural change, not a cleanup.
- A spike can test whether outbox truth plus alarm redrive can drive delivery
  without Queue for a canary subset, while preserving outbox rows and final
  outcome semantics.

Benefit estimate:

- Possible savings: one queue hop and one consumer activation in the Wake path.
- Actual post-closeout data is N=1 after final deploy; that sample showed
  queue batch duration of 5946 ms, but it cannot distinguish queue wait,
  preflight, route, delivery, or controller time. No deletion decision should
  use that single number.

Spike plan:

1. Make dispatch segment timing queryable first.
2. Prototype direct outbox delivery behind a dev-only flag.
3. Preserve the same durable outbox lifecycle states and redrive visibility.
4. Stress test with concurrent Wakes, Hub unavailable, route stale, binding
   mismatch, and delivery timeout.
5. Compare p50/p95 signal-to-delivery and failure recovery against Queue.

Dependencies:

- Depends on dispatch timing data and failure-rate evidence.
- Should come after smaller dispatch critical-path work.

### 5. Gateway double auth tax

Classification: B/C.

Risk: medium. The Gateway layer itself is not waste. The candidate waste is
two serial auth-worker RPCs per authenticated request and additional per-route
profile resolution.

Current state:

- Gateway middleware calls auth-worker twice in series:
  `services/gateway/src/middlewares/auth.ts:40-47` resolves request auth, then
  `services/gateway/src/middlewares/auth.ts:81-91` resolves the profile.
- The RPC client exposes those as separate upstream calls:
  `services/gateway/src/lib/auth-rpc-client.ts:56-68` and
  `services/gateway/src/lib/auth-rpc-client.ts:70-106`.
- Auth's `resolveProfile` performs its own authenticated-user resolution before
  reading profile information:
  `services/auth/src/lib/rpc/entrypoint.ts:438-465`, while
  `services/auth/src/lib/rpc/entrypoint.ts:960-991` is the separate
  `resolveRequestAuth` path.
- Some routes call `resolveProfile` per target profile too:
  `services/gateway/src/routes/rpc-http.members.ts:336-364`.

Consumers:

- All authenticated Gateway routes through auth middleware.
- Routes that need actor profile context.
- Member/profile-specific route helpers.
- Core request context built by Gateway.

Delete/simplify safety:

- Do not remove Gateway or fail-open on profile mismatches.
- A safe design is either:
  - one auth RPC returning authenticated user claims plus selected profile in
    one response, or
  - a tiny request-scoped or 5-10 s cache keyed by session identity plus
    requested profile id, with explicit invalidation limits.
- Risks to prove: profile switching, explicit `OPENMELD_HEADER_PROFILE_ID`, account
  mismatch, anonymous route bypass, session revocation, and profile deletion.

Benefit estimate:

- Expected savings: one auth-worker RPC on most authenticated API requests. The
  starting hypothesis is about 20-80 ms/request, but this survey did not find a
  queryable production distribution by route/auth segment.
- Secondary savings: fewer auth-worker activations.

Required data and thresholds:

- Add or expose Gateway auth segment timing by route. Candidate threshold for
  action: duplicated auth/profile RPC p95 above 40 ms or above 15 percent of
  API request duration for common routes.
- Count profile mismatch/rejection/session revocation events for at least
  seven days before adding TTL caching.

Dependencies:

- Can proceed independently of dispatch/Queue.
- Requires auth owner review because it changes auth-worker RPC shape.

### 6. Dispatch consumer preflight and inline activity signal

Classification: B for data decision, C for any structural preflight rewrite.

Risk: medium-high. These checks sit on the Wake critical path, but many are
fail-closed guardrails.

Current state:

- Dispatch queue service creates timing collectors and wraps dispatch phases:
  `services/core/src/dispatch/application/dispatch-queue-service.ts:539-552`
  creates the message attempt context, and
  `services/core/src/dispatch/application/dispatch-queue-service.ts:592-596`
  wraps preflight.
- `emitDispatchingActivitySignal` is still inline:
  `services/core/src/dispatch/application/dispatch-queue-service.ts:652-662`.
- Head accept and delivery are timed:
  `services/core/src/dispatch/application/dispatch-queue-service.ts:717-731`
  and `services/core/src/dispatch/application/dispatch-queue-service.ts:752-764`.
- The structured log includes the formatted Server-Timing string:
  `services/core/src/dispatch/application/dispatch-queue-service.ts:3861-3877`.
- The preflight auth segment wraps effective target binding resolution:
  `services/core/src/dispatch/application/dispatch-execution-service.ts:2717-2815`.
- Delivery performs route lookup and several blockers:
  `services/core/src/dispatch/application/dispatch-execution-service.ts:485-526`
  reads source/target facts and route, while
  `services/core/src/dispatch/application/dispatch-execution-service.ts:542-659`
  handles offline, update, forgotten device, and binding match blockers.
- Queue consumer runtime evidence currently exposes batch duration, not the five
  Server-Timing segments:
  `services/core/src/dispatch/transport/queue/dispatch-queue-consumer.ts:15-49`.

Consumers:

- Dispatch queue consumer.
- Space visible progress.
- RuntimeTransportHub delivery.
- Dispatch ledger/final outcome diagnostics.
- Support trace commands.

Delete/simplify safety:

- Do not delete fail-closed checks because a production sample says they rarely
  block. Need both data and owner-doc proof that the fact is redundant or was
  moved to an earlier authoritative gate.
- `emitDispatchingActivitySignal` is the best critical-path candidate because
  it is progress visibility, not final authority. Even then, moving it out of
  line must preserve "dispatching" UX or replace it with equivalent visible
  progress.
- Parallelizing source signal, target binding, route lookup, and activity
  writes is plausible, but only after proving which segments dominate.

Benefit estimate:

- Post-final-deploy production evidence: one current sample with queue batch
  duration 5946 ms and final visible outcome about 42 s after signal post. This
  does not isolate dispatch preflight from route/delivery/controller time.
- Potential savings are likely tens to hundreds of ms for preflight, but the
  inline activity signal could be larger if Space DO write contention is high.

Required data and thresholds:

- Make `openmeld_dispatch_auth`, `openmeld_dispatch_activity`,
  `openmeld_dispatch_head_accept`, `openmeld_dispatch_route`, and `openmeld_dispatch_deliver`
  queryable for at least 100 post-closeout dispatches.
- Candidate thresholds:
  - move activity signal off-path if `openmeld_dispatch_activity` p95 exceeds 50 ms
    or 10 percent of queue message duration;
  - parallelize if any independent segment p95 exceeds 100 ms and is not a
    fail-closed authority dependency;
  - remove a check only after seven days of zero valid blocks and an owner-doc
    proof that the check is not the only fail-closed boundary.

Dependencies:

- Depends on queryable dispatch Server-Timing data.
- Should precede any Queue removal spike.

### 7. Controller cold start

Classification: D.

Risk: high. Warm pools and persistent controllers can improve latency, but they
change local process lifetime, cancellation, permissions, auth state, and
diagnostics.

Current state:

- The default Codex adapter dispatch path resolves a launch contract and invokes
  Codex through the local CLI:
  `runtime/adapters/codex/src/index.ts:196-230`.
- Codex local-cli transport builds args, materializes the launch command, and
  calls the shared CLI driver:
  `runtime/adapters/codex/src/transport/codex-cli-transport.ts:70-99`.
- The shared CLI driver calls `spawn` for each invocation and records lifecycle
  telemetry:
  `runtime/adapters/core/src/drivers/cli-driver.ts:45-94`.
- Telemetry already contains process spawn and first output fields:
  `runtime/adapters/core/src/index.ts:148-165`.
- Codex app-server transport exists, but this implementation starts and closes
  an app-server session around the callback:
  `runtime/adapters/codex/src/transport/codex-app-server-transport.ts:420-431`.
  The session itself spawns `codex app-server --listen stdio://` and initializes
  it:
  `runtime/adapters/codex/src/transport/codex-app-server-transport.ts:484-613`.
- The app-server transport tracks active turns for interrupt support:
  `runtime/adapters/codex/src/index.ts:109-175`.

Consumers:

- Local OpenMeld Service dispatch adapters for Codex, Claude, OpenCode/OpenClaw.
- Runtime process tracking and interrupt/cancel behavior.
- Controller-specific auth and context recovery.
- Provider conversation proof and diagnostics.

Delete/simplify safety:

- Do not replace local-cli with a warm pool as a cleanup. This is a new runtime
  mode with new lifecycle rules.
- Safe next step is a design note and telemetry readout:
  measure `processSpawnedAtMs - invokedAtMs`, `firstStdoutAtMs - invokedAtMs`,
  and `firstOutputAtMs - invokedAtMs` per adapter.
- Codex is the best spike target because app-server transport already exists.
  Claude/OpenCode need separate feasibility checks.

Benefit estimate:

- User-provided hypothesis: 1-4 s cold start per Wake. Code confirms per-call
  spawn on local-cli, but this survey did not collect local production adapter
  telemetry distribution.

Dependencies:

- Requires local-service process lifecycle design.
- Should not be bundled with Queue or dispatch preflight changes.

### 8. Space loading

Classification: B.

Risk: medium. Bootstrap already parallelizes major branches. Further gains
need production distribution and cache correctness.

Current state:

- Web reads one bootstrap query for status, members, history, and threads:
  `clients/web/src/query/spaces/bootstrap.ts:20-75`.
- Gateway returns the Core/Space bootstrap payload and forwards `Server-Timing`:
  `services/gateway/src/routes/rpc-http.bootstrap.ts:17-69`.
- Core RPC routes to the Space DO timed bootstrap method:
  `services/core/src/rpc/methods.ts:2558-2570`.
- Space DO creates a timing collector and reads status, members, history, and
  threads under a total timing measurement:
  `services/core/src/space/transport/do/space.ts:2920-2984`.
- The branch reads are already parallelized through `Promise.all`:
  `services/core/src/space/transport/do/space.ts:2937-2972`.
- Timing output includes `openmeld_bootstrap_total`, status, members, history, and
  threads:
  `services/core/src/space/application/space-bootstrap-timing.ts:70-120`.

Consumers:

- Space landing initial load.
- Gateway HTTP route and browser Server-Timing.
- Space status/members/history/thread queries.

Delete/simplify safety:

- Do not delete branches blindly. The main branches are already parallel; the
  next simplification is caching, smaller payloads, or separating slow branches,
  not "make it parallel."
- Current Analytics Engine runtime evidence does not persist route/method or
  Server-Timing segment fields in queryable columns:
  `packages/schemas/src/schemas/http/observability-runtime-event.ts:8-37`
  lists persisted Analytics blobs/doubles, while
  `packages/schemas/src/schemas/http/observability-runtime-event.ts:73-90`
  has route/method/duration in the event schema but not in the Analytics column
  list. The query contract derives columns from that list:
  `scripts/cloudflare/runtime-evidence-contract.mjs:13-34`.

Benefit estimate:

- Potential user-visible gain is high if history or members dominates first
  load, but no production segment distribution is currently queryable from AE.
- Expected safe first gain is observability, not code deletion.

Required data and thresholds:

- Persist or tail aggregate bootstrap `Server-Timing` by route.
- Collect at least 100 bootstrap loads.
- Candidate action thresholds:
  - if `openmeld_bootstrap_history` p95 exceeds 500 ms and dominates total, split or
    lazy-load older history;
  - if `openmeld_bootstrap_members` p95 dominates, cache/preload owner service facts;
  - if total p95 is already under 500 ms, avoid structural churn.

Dependencies:

- Depends on queryable route and timing evidence.
- Independent of Wake dispatch work.

### 9. Dead code and unused surface cleanup

Classification: A for the listed items.

Risk: low. These are local cleanup candidates with no identified runtime
consumers.

Current state:

- No checked-in dead-export tool was found. `knip` and `ts-prune` are not
  installed. Web TypeScript does enable unused checks:
  `clients/web/tsconfig.json:49-51`.
- Stale live-badge helpers are exported but not called:
  `clients/web/src/lib/spaces/presentation.ts:388-411` defines
  `resolveLiveBadgeLabel` and `resolveLiveBadgeClassName`. Current header logic
  uses local live-status presentation instead:
  `clients/web/src/components/spaces/space-header.tsx:284-320`.
- `expectedProfileIdsKey` is written but not read:
  `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:436-440`
  defines the field,
  `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:9043-9056`
  writes it, and
  `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:9028-9040`
  checks only lease key and age.
- Mention-failure hint emission is a no-op after a previous planner switch:
  `services/core/src/space/transport/do/space.ts:8929-8931`.
  The port still requires it:
  `services/core/src/space/application/space-signal-service.ts:148-168`,
  and the service still calls it:
  `services/core/src/space/application/space-signal-service.ts:194-196`.
  Space wires the no-op:
  `services/core/src/space/transport/do/space.ts:10684-10694`.

Consumers:

- Live-badge helpers: no callers found in `clients/web/src` or `packages`.
- `expectedProfileIdsKey`: only definition and write were found.
- Mention-failure hint port: consumed only by the signal service contract and
  tests that verify the port call, while production implementation is no-op.

Delete/simplify safety:

- Remove stale live-badge helpers and any tests that cover only those helpers.
- Remove `expectedProfileIdsKey` from the cache state and write path. Behavior
  remains age plus lease-set-key freshness.
- Remove mention-failure hint from the port and call site. Because production
  implementation is already intentionally disabled, behavior should not change.

Benefit estimate:

- Small LOC reduction, likely under 100 production LOC plus tests.
- Main benefit is removing misleading architecture signals.

Dependencies:

- Independent. These can be batched as a low-risk cleanup PR after review.

### 10. User-visible status surface

Classification: D.

Risk: medium as a product change, high if it deletes internal diagnostics.

Current state:

- Public Wake availability has four categories:
  `packages/agent-runtime/src/agent-wake-availability.ts:9-32`.
- Space member presentation maps those into live/wakeable/checking/offline/
  unavailable states:
  `packages/space/src/presentation/space-member-agent-presence.ts:11-42` and
  `packages/space/src/presentation/space-member-agent-presence.ts:97-175`.
- Readiness maps reasons to primary user actions:
  `packages/agent-runtime/src/agent-execution-status.ts:4-17`.

Consumers:

- Space member cards and Wake affordances.
- Agents page profile cards.
- Setup and repair actions.
- Diagnostics and support traces.

Delete/simplify safety:

- User mental model can be simplified to three questions:
  can I use it, should I wait, what do I need to do.
- Internal model should not collapse. Offline, Unavailable, provider blocked,
  service update required, and route checking are different diagnostics and
  sometimes different repair actions.
- The safe direction is presentation grouping, not Core projection deletion.

Benefit estimate:

- Potential UX clarity improvement, no direct latency savings.
- Could reduce copy/component branching on client surfaces after product review.

Dependencies:

- Requires product decision and copy review.
- Should happen after readiness terminology cleanup.

### 11. Production observability gaps are now a simplification blocker

Classification: B.

Risk: low to add observability, high to proceed without it.

Current state:

- Analytics Engine compact projection intentionally stores selected blobs and
  doubles:
  `packages/schemas/src/schemas/http/observability-runtime-event.ts:8-37`.
- The richer runtime event schema includes operation, route, method, duration,
  and status:
  `packages/schemas/src/schemas/http/observability-runtime-event.ts:73-90`.
- The query tooling derives AE columns from the compact contract:
  `scripts/cloudflare/runtime-evidence-contract.mjs:13-34`.
- Disconnect aggregation endpoint exists on RuntimeTransportHub:
  `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts:4331-4363`,
  and internal client methods exist:
  `services/core/src/dispatch/infrastructure/runtime-transport/runtime-transport-client.ts:295-309`.
  This survey did not find a checked-in public ops route/tool that queries it
  directly.

Consumers:

- Round-3 deletion decisions.
- Support and regression triage.
- Dispatch and bootstrap performance analysis.

Delete/simplify safety:

- Before deleting dispatch checks, reducing frontend polling, or caching Gateway
  auth, make the relevant production distributions queryable.
- Adding queryable timing evidence is not product behavior; it is the proof
  surface needed to make deletion safe.

Benefit estimate:

- No direct latency savings.
- High leverage because it prevents speculative architecture surgery.

Dependencies:

- Should be first in the Round-3 sequence.

## Recommended Dependency Order

1. Land small A cleanups after reviewer agreement: stale live-badge helpers,
   `expectedProfileIdsKey`, and no-op mention-failure hint.
2. Add or expose queryable metrics for dispatch timing, bootstrap timing,
   Gateway auth timing, invalidation convergence, and disconnect rates.
3. After at least 24 hours or 100 relevant samples, decide B items:
   Gateway auth, dispatch activity/preflight, frontend refresh budgets, and
   Space loading split/cache work.
4. Run C spikes in isolation:
   CLI two-loop timer shape and Queue bypass.
5. Keep D items as design notes:
   internal terminology cleanup, controller warm-pool, and user-facing status
   grouping.

## Red Lines Confirmed

This survey does not recommend weakening:

- fail-closed identity, ownership, readiness, or execution checks;
- ServiceRuntime as liveness source;
- Core-owned `AgentExecutionReadiness` as user-facing Wake availability truth;
- read paths that avoid live probing;
- diagnostics and dispatch ledger as evidence, not authority;
- owner-doc governance and deploy order;
- strict schema practice;
- Gateway as the external boundary;
- Queue without a spike proving equivalent retry, isolation, and backpressure.

## Acceptance Check Against Owner Docs

The report itself changes no runtime behavior. The recommendations preserve the
owner-doc rule that RuntimeCoordinator is in-flight Wake truth, Queue is the
dispatch conveyor, ServiceRuntime owns liveness, Core readiness owns
user-facing Wake availability, and invalidation frames are refresh signals only.
Any future implementation touching CLI, OpenMeld Service carrier files, daemon
schemas, Prepare schemas, shared HTTP/RPC/WebSocket schemas, or
`release/local-components.json` must complete the Contract Impact Audit and the
required release-readiness gate before being declared done.

## Data Window Review

Review time: `2026-07-03T13:04:48Z`.

Window requested by the work order: after the final Round-2 closeout Core deploy
at `2026-07-02T12:58:22Z`, through the scheduled review point at
`2026-07-03T12:58:27Z`. The checked query path uses
`corepack pnpm ops:cf:query --since 24h` with the Cloudflare account id recorded
in Round 2, so the effective query lower bound is the 24-hour production window
immediately preceding this review. The first matching dispatch row in this
window was at `2026-07-02 13:12:57`, and the first matching bootstrap total row
was at `2026-07-02 14:26:53`.

### Sample Sufficiency

The requested `>=100` Wake dispatch and `>=100` Space bootstrap floor was not
met.

| Evidence | Sampled rows | Estimated rows from `sampleInterval` | Time range observed | Result |
| --- | ---: | ---: | --- | --- |
| `core.openmeld.dispatch.queue_message_started` | 40 | 51 | `2026-07-02 13:12:57` -> `2026-07-03 12:55:38` | below the 100-dispatch floor |
| `core.openmeld.dispatch.queue_batch_succeeded` | 36 | 47 batches / 56 messages | `2026-07-02 13:13:03` -> `2026-07-03 12:56:14` | below the 100-dispatch floor |
| `gateway.openmeld.space.bootstrap_server_timing`, `openmeld_bootstrap_total` | 18 | 82 | `2026-07-02 14:26:53` -> `2026-07-03 12:09:38` | below the 100-bootstrap floor |

At the observed rate, bootstrap probably needs roughly six more hours to cross
100 estimated rows. Wake dispatch probably needs roughly one more day to cross
100 estimated started rows, and the sampled per-segment timing rows may need
longer. Recommendation: re-run the same review after at least another 24 hours
unless traffic increases materially.

### Dispatch Segment Distribution

Command:

```text
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --event core.openmeld.dispatch.queue_server_timing --aggregate timing --limit 500
```

Raw rows were also summarized locally to estimate p50/p95 over the sampled
rows. Because Analytics Engine sampling does not return a complete per-dispatch
waterfall, the percentages below are directional only.

| Segment | Sampled rows | Estimated rows | Min | Avg | p50 | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `openmeld_dispatch_auth` | 11 | 21 | 97 ms | 1153 ms | 1009 ms | 2832 ms | 2832 ms |
| `openmeld_dispatch_activity` | 8 | 15 | 16 ms | 66 ms | 39 ms | 266 ms | 266 ms |
| `openmeld_dispatch_head_accept` | 9 | 17 | 308 ms | 643 ms | 622 ms | 991 ms | 991 ms |
| `openmeld_dispatch_route` | 8 | 14 | 77 ms | 266 ms | 244 ms | 459 ms | 459 ms |
| `openmeld_dispatch_deliver` | 13 | 25 | 1602 ms | 1972 ms | 1867 ms | 2918 ms | 2918 ms |

`openmeld_dispatch_activity` is not the dominant segment by share: its average is
about 1.6 percent of the sum of the five segment averages. The small-sample p95
and max are both 266 ms, which is above the survey's original 50 ms candidate
threshold. That makes `emitDispatchingActivitySignal` worth keeping on the
candidate list for off-path delivery, but the data window is still too small to
approve moving it out of the inline path.

Decision for this review: do not implement the inline-path move yet. Recheck
after `>=100` dispatch timing samples, and require the implementation proposal
to preserve equivalent visible "dispatching" progress because activity is
visibility, not execution authority.

### Dispatch Preflight And Blockers

The current timing path exposes one preflight segment,
`openmeld_dispatch_auth`, which wraps Core-owned target Binding and owner resolution.
It does not expose separate production counters for each internal check. Route
lookup, service update blocking, forgotten-device blocking, and primary Binding
route match checks happen later in the delivery path.

Queries checked:

```text
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --worker openmeld-core --search dispatch_queue --status failed --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --worker openmeld-core --search preflight --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --worker openmeld-core --search blocked --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --worker openmeld-core --search terminal_failure --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --search route_blocked --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --search service_update_required --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --search forgotten_dispatch_blocked --limit 100
corepack pnpm ops:cf:query --account-id c511849a74548b7f9be7e3a280afeb8f --since 24h --search binding_source --limit 100
```

Observed result: those blocker-specific searches returned no rows. A broader
`--worker openmeld-core --status failed` query returned one dispatch-linked failed
runtime evidence row, `core.openmeld.daemon.runtime_evidence` with
`reasonCode=upstream_unreachable`; that is local daemon execution evidence, not
a preflight rejection.

Decision for this review: no preflight check is approved for deletion. The
absence of AE-visible blockers is useful signal, but it is not proof that the
checks are redundant because the current telemetry does not count every
fail-closed check independently. The only safe candidates are observability and
parallelization work:

- Add queryable per-check blocker counters before proposing deletion.
- Keep `agent_profile_binding.missing`, `agent_profile_binding.disabled`,
  `agent_profile_binding.lookup_failed`, service update, forgotten-device, and
  route-vs-Binding checks fail-closed.
- Consider a later critical-path refactor only where dependency order is
  explicit. For example, route lookup still depends on owner resolution from
  the auth/binding step, while the visible dispatching activity write is not an
  authority dependency.

### Front-End Bounded Refresh Convergence SLA

No production convergence distribution is available from the checked Analytics
path. Searches for `agent.readiness.invalidated` and `readiness` in
`ops:cf:query` returned no runtime-evidence rows in the 24-hour window. Current
Web code has local propagation, 500 ms coalescing, and tests, but no production
metric for:

```text
readiness invalidation frame observed in browser -> active cache refresh
completed -> rendered Core readiness changed
```

Decision for this review: do not narrow or delete the bounded refresh windows
from Finding 1 yet. Add a small Web/Gateway/Core-visible measurement first, or
run a real browser smoke that records this interval under visible tab, hidden
tab, refocus, BroadcastChannel fallback, and Space navigation conditions.

The current owner-doc rule still applies: invalidation frames are refresh
signals only, missed frames must be recoverable by the next snapshot/read, and
clients must not derive readiness truth from the frame itself.

## Execution Log

### 2026-07-02 Immediate Round-3 Work

Scope executed:

- `f06091e8e` - `Make timing segments queryable in ops evidence`
  - Pathspec: `scripts/cloudflare/query-runtime-evidence.mjs`,
    `scripts/cloudflare/query-runtime-evidence.test.mjs`,
    `services/core/src/dispatch/application/dispatch-queue-service.ts`,
    `services/core/src/space/application/space-bootstrap-timing.ts`,
    `services/gateway/src/routes/rpc-http.bootstrap.ts`,
    `services/gateway/src/routes/rpc-http.helpers.ts`,
    `services/gateway/tests/http-forwarding.test.ts`,
    `packages/schemas/tests/http/http-schemas.test.ts`.
  - Result: dispatch Queue Server-Timing segments emit one runtime-evidence
    Analytics Engine datapoint per segment with event
    `core.openmeld.dispatch.queue_server_timing`, segment name in `reasonCode`, and
    segment duration in `durationMs`. Space bootstrap timing now carries the
    Core timing metrics through Gateway success handling and emits equivalent
    datapoints under `gateway.openmeld.space.bootstrap_server_timing`.
  - `ops:cf:query` now supports `--aggregate timing` and `--reason-code`, so
    ops can group by `reasonCode` and aggregate row count, sample interval,
    min/avg/max duration using the existing runtime-evidence projection.
  - Owner-doc gate: observability-only. Queue remains the reliable dispatch
    conveyor, RuntimeCoordinator remains Wake execution truth, Core readiness
    remains availability truth, and bootstrap response payload semantics do not
    change.
  - Validation: `node --test scripts/cloudflare/query-runtime-evidence.test.mjs
    scripts/cloudflare/runtime-evidence-contract.test.mjs`;
    `pnpm --filter @openmeld/schemas exec vitest run
    tests/http/http-schemas.test.ts`;
    `pnpm --filter @openmeld/gateway exec vitest run
    tests/http-forwarding.test.ts`;
    `pnpm --filter @openmeld/core exec vitest run
    src/__tests__/dispatch-queue-consumer.test.ts`;
    `pnpm exec ultracite check` on the touched files; SQL dry-runs for both
    dispatch and bootstrap timing aggregate queries.

- `b27d1f192` - `Remove the unused route read cache profile key`
  - Pathspec:
    `services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts`.
  - Result: removed the write-only `expectedProfileIdsKey` field from the
    expected-route reconciliation read cache state and removed the now-dead
    function input. The cache freshness check still keys on lease set and age,
    exactly as before.
  - Owner-doc gate: no lifecycle, liveness, route ownership, readiness, or
    RuntimeCoordinator behavior changes. This only removes unused internal
    memory state.
  - Validation: `pnpm --filter @openmeld/core exec vitest run
    tests/runtime-transport-lease-reconcile.test.ts`;
    `pnpm --filter @openmeld/core check`;
    `pnpm exec ultracite check
    services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts`;
    `rg` confirmed `expectedProfileIdsKey` no longer exists.

- `ffa131995` - `Remove stale live badge helpers`
  - Pathspec: `clients/web/src/lib/spaces/presentation.ts`.
  - Result: removed unused `resolveLiveBadgeLabel` and
    `resolveLiveBadgeClassName` exports and narrowed the timeline type import.
    Current-tree verification found no remaining helper imports; there was no
    still-present orphan test import to delete.
  - Owner-doc gate: no availability, readiness, live invalidation, or Space
    convergence behavior changes. The current Space header live indicator keeps
    using its local display path.
  - Validation: `pnpm --filter openmeld-web exec vitest run
    src/lib/spaces/presentation.test.ts`;
    `pnpm --filter openmeld-web check`;
    `pnpm exec ultracite check clients/web/src/lib/spaces/presentation.ts`;
    `rg` confirmed the removed helper names no longer exist.

Final related package floor after the commits:

- `pnpm --filter @openmeld/core check` passed.
- `pnpm --filter @openmeld/gateway check` passed.
- `pnpm --filter @openmeld/schemas check` passed.
- `pnpm --filter openmeld-web check` passed; it printed the existing Biome
  `recommended` deprecation info and exited successfully.

Explicitly not executed in this pass:

- Mention-failure no-op port in `space.ts` / `space-signal-service.ts`,
  deferred to avoid concurrent Space DO assembly changes.
- Gateway double-auth implementation, frontend refetch/stale-time tuning, and
  Space loading bootstrap optimization, all owned by the concurrent performance
  batch.
- B-class production-data recheck and C-class spike proposals, deferred until
  the requested data window after `2026-07-03T12:58Z` or at least 100 relevant
  samples.

### 2026-07-02 Space Follow-Up

Scope executed:

- Removed the deferred mention-failure no-op port from
  `services/core/src/space/transport/do/space.ts` and
  `services/core/src/space/application/space-signal-service.ts`, plus the dead
  test harness wiring that only proved the no-op stayed silent. Dispatch
  planning remains driven by `messageEnvelope.activationTargets`; the removed
  port no longer published, scheduled, or affected Wake behavior.

- Hardened the Space background alarm and dispatch outbox flush against poison
  candidates. Each self-healing alarm lane now runs through an isolated
  diagnostic wrapper, and per-candidate outbox redrive failures are caught,
  logged, skipped for that round, and counted in persistent Space SQL state.
  After three consecutive candidate failures, the outbox row is marked poison
  and excluded from future candidate scans instead of being deleted or
  delivered. The stopped guard still runs before delivery decisions; failures
  are never converted to `{ stopped: false }`, so unreadable Stop intent stays
  fail-closed and does not dispatch.

- Added `openMeldDaemon_outbox` poison columns
  (`poison_failure_count`, `poisoned_at_ms`, `poison_reason_code`) with schema
  migration coverage, plus repository helpers to record and clear candidate
  poison state. Successful redrive clears prior poison counters.

- While re-running the full Core floor, `space-members-service.test.ts` exposed
  a stable existing regression: an unavailable route lookup was projected as
  `offline_for_wake` through the shared
  `packages/agent-runtime` Wake availability resolver. Fixed the shared
  resolver so `wakeRouteStatus.status === "unavailable"` with
  `connect_service` stays `unavailable_for_wake`, preserving the diagnostic
  `lookup_failed` reason instead of inventing stable offline evidence.

- Gate-only cleanup: removed an unused `resolveSignalActivityProfileId` helper
  and hoisted a test regex in `space-members-service.test.ts` so the current
  Core lint floor can pass.

Owner-doc gate:

- Agent Transport Contract: RuntimeCoordinator remains in-flight Wake execution
  truth; Queue remains the conveyor; this change only prevents one bad outbox
  candidate from starving other recovery work. Candidate delivery still requires
  the stopped guard and existing outbox decision path to succeed.
- Data and Observability: poison counters and diagnostics are evidence only.
  They do not authorize delivery, finalize executions, or rewrite readiness.
- Shared Contracts: Wake availability still comes from the shared Core-owned
  readiness projection. The shared resolver change avoids downgrading unknown
  route lookup truth into stable offline truth.
- Space Collaboration: Space still owns visible outcomes. The poison path does
  not publish a fallback success/failure message; it parks unreadable work for
  diagnostics and keeps later candidates moving.

Validation:

- `pnpm --filter @openmeld/agent-runtime run build`
- `pnpm --filter @openmeld/agent-runtime run check`
- `pnpm --filter @openmeld/agent-runtime run test`
- `pnpm --filter @openmeld/core exec vitest run
  tests/space-signal-consistency.test.ts
  src/__tests__/space-outbox-watchdog.test.ts
  src/__tests__/space-signal-service.test.ts
  src/__tests__/accepted-dispatch-finalization.test.ts
  tests/space-sql-schema.test.ts`
- `pnpm --filter @openmeld/core exec vitest run
  tests/space-members-service.test.ts -t "preserves unavailable daemon route
  truth instead of collapsing lookup failures into offline"`
- `pnpm --filter @openmeld/core run check`
- `pnpm --filter @openmeld/core run test:full`
- `pnpm exec ultracite check` on the touched Core/agent-runtime files
- `git diff --check`

Explicitly deferred:

- Web `space-landing.integration.test.tsx` readiness refresh failures remain a
  separate window-period cleanup item as requested.

### 2026-07-02 Space Poison Parking Closeout

Scope executed:

- Confirmed the remaining poison parking risk: a row with `poisoned_at_ms` is
  excluded from dispatch outbox candidate scans, and a candidate that had not
  reached Queue or RuntimeCoordinator head would not necessarily have any
  five-minute deadline path to publish a visible terminal outcome. Active
  wake-progress can still inspect some outbox rows, but progress is not the
  Space final visible outcome contract.

- Changed the poison transition order for dispatch outbox candidates. A
  candidate failure now first increments `poison_failure_count`. Once the
  threshold is reached, Space publishes a persisted `terminal_failure`
  `signal.system_notice` with the same user-facing copy family as the
  Round-2 C4.1 owner-unresolved path:
  `OpenMeld could not wake @Agent because OpenMeld could not confirm the agent's account right now. Try again in a moment.`
  Only after that notice is persisted and backed by a readable final claim does
  Space set `poisoned_at_ms`.

- If terminal notice publication fails, or if a final claim exists but the
  claimed signal cannot be read, the candidate is not parked. It remains
  eligible for the next outbox scan, so the system stays fail-closed for
  delivery while avoiding a silent disappearance. A poison success diagnostic
  now carries the final signal id for operator correlation.

- Updated the existing outbox poison tests and the Space signal consistency
  matrix so both prove the new invariant: one poison candidate does not block
  later candidates, but a poison candidate only exits retries after a visible
  terminal outcome exists.

Owner-doc gate:

- Space Collaboration: preserved the rule that one Wake must end as one
  persisted reply, explicit stopped outcome, or explicit visible failure. A
  parked candidate can no longer silently remove the Wake from the retry path.
- Agent Transport Contract: RuntimeCoordinator remains the in-flight execution
  authority and Queue remains the conveyor. This does not fabricate a
  RuntimeCoordinator head; Space writes the failure notice through the existing
  final-claim protection before excluding the local outbox row.
- Data and Observability: poison counters and poison reason remain diagnostic
  evidence only. They do not authorize delivery, decide readiness, or finalize
  a RuntimeCoordinator execution.
- Shared Contracts: no schema or wire-contract expansion. The system-notice
  reason is an existing open string field, and clients still read the Space/Core
  projections after invalidation instead of deriving truth from the event.

Validation:

- `corepack pnpm --filter ./services/core run check`
- `corepack pnpm --filter ./services/core exec vitest run --config
  vitest.config.ts src/__tests__/space-outbox-watchdog.test.ts
  src/__tests__/space-signal-service.test.ts --testNamePattern
  "poison|terminal failure|RuntimeCoordinator failure publication|final
  terminal failure"`
- `corepack pnpm --filter ./services/core exec vitest run --config
  vitest.config.ts tests/space-signal-consistency.test.ts --testNamePattern
  "skips a poison outbox candidate"`
- `corepack pnpm --filter ./services/core run test:full`
  - Final pass: 130 files, 1416 tests.

### 2026-07-03 Data Window Review

Scope executed:

- Queried the post-closeout production Analytics Engine window with
  `corepack pnpm ops:cf:query` and the Round-2 Cloudflare account id.
- Added the `Data Window Review` section to this survey.
- Added two proposal-only spike docs. The Queue bypass spike was absorbed into
  the transport owner documents and deleted after its 2026-08-04 production
  decision; the CLI timer proposal remains at
  `developing/architecture/review/2026-07-cli-timer-convergence-spike.md`.
- Checked the two Task C residuals:
  - poison-parked outbox visible terminal failure was already completed in the
    2026-07-02 Space Poison Parking Closeout above;
  - `clients/web/src/components/spaces/space-landing.integration.test.tsx` is
    currently green under `vitest.integration.config.ts`, so no test edit was
    required in this pass.

Data result:

- The requested production sample floor was not met. The 24-hour window had
  51 estimated Wake dispatch starts and 82 estimated Space bootstrap totals.
- `openmeld_dispatch_activity` was small by average share, about 1.6 percent of the
  five dispatch segment averages, but the sampled p95/max was 266 ms. This
  keeps it as an off-path candidate but is not enough to approve moving
  `emitDispatchingActivitySignal` out of the inline path.
- No AE-visible preflight/blocker rows were found for the checked blocker
  searches. The current telemetry does not count every fail-closed check
  independently, so no preflight check is approved for deletion.
- No production invalidation-to-convergence SLA exists in AE for
  `agent.readiness.invalidated`; bounded frontend refresh windows should not be
  narrowed or removed until that measurement exists.

Owner-doc gate:

- No product behavior changed. Queue remains the dispatch conveyor,
  RuntimeCoordinator remains in-flight Wake execution truth, Space remains the
  final visible outcome owner, and live invalidation frames remain refresh
  signals only.
- The spike docs are proposal-only and explicitly require owner-boundary
  preservation plus review before implementation.

Validation:

- `corepack pnpm --filter openmeld-web exec vitest run --config
  vitest.integration.config.ts
  src/components/spaces/space-landing.integration.test.tsx`
  - Passed: 1 file, 134 tests.
