# Wake Latency Baseline — Production Measurement (2026-07-02)

## Agent Context

- Purpose: Preserve the July 2 production measurements used by Wake latency
  work.
- Read this when: Comparing a newer Wake latency sample or prioritizing a
  measured stage.
- Update this when: A comparable production baseline supersedes these samples.
- Do not use this for: Current health, SLA, or per-Wake execution truth.
- Source of truth: This file owns only the dated measurements.

Status: BASELINE REVIEW — Keep while Wake latency optimization work uses this
baseline; replace or remove after a newer production baseline supersedes it.

Independent study: how much of a production Wake round-trip is transport
("on the road") versus actual agent work. Three controlled Wakes were sent
from OpenMeld Web (Chrome, human profile) in Felix's OpenMeld Welcoming Space, one per
controller, each asking the agent for the current date and time so the reply
itself carries a timestamp anchor.

Method and evidence sources:

- Server-side signal timestamps from `openmeld space history --view agent`
  (millisecond `ts` on the wake signal and the reply signal).
- Cloud-side stage timestamps from `openmeld service trace --details`
  (`openmeld.observability.wake.v1`: `dispatch.firstSeenAt`,
  `runtimeCoordinatorExecution.createdAtMs`, `resultInbox.acceptedAt`,
  `replySignal.createdAt`).
- Local daemon stage timestamps from
  `~/.openmeld/runtime/daemon/logs/daemon-dispatch-journal.jsonl`
  (deliver.received, phase events, runtime_invocation_started,
  completed_local, outbox flush events).
- Agent-internal timelines from controller session records (Claude Code
  headless session JSONL; Codex rollout JSONL with per-command wall times).
- Clock skew between this MacBook and Cloudflare measured from
  result-send/inbox-accept pairs: local clock runs ~0.9-1.1s ahead
  (3 samples: 0.89s, 1.12s, 0.95s). Local timestamps below are corrected by
  -1.0s when mixed with cloud timestamps.

## End-to-end results

| # | Agent (controller / model) | Signal ts (UTC) | Reply ts | End-to-end | Transport total | Agent execution | Agent share |
|---|---|---|---|---|---|---|---|
| 1 | Claude Code Opus 4.8 (claude-code) | 15:48:59.445 | 15:49:50.361 | **50.9s** | 13.1s (25.7%) | 37.8s | 74.3% |
| 2 | Opencode Deepseek V4 (opencode) | 15:52:51.462 | 15:53:19.695 | **28.2s** | 12.1s (42.7%) | 16.2s | 57.3% |
| 3 | Felix's OpenMeld Assistant (codex / gpt-5.5) | 15:55:03.276 | 15:55:50.659 | **47.4s** | 12.6s (26.6%) | 34.8s | 73.4% |

Reference samples from earlier the same day (Codex, manual): 16:29 wake and
23:05 wake; the 23:05 one shows the same shape (deliver +6.9s from an
identical pipeline, agent execution 25.7s).

**Headline: every Wake carries a roughly constant ~12-13s transport tax,
independent of controller and of what the agent does.** For a trivial
question that tax is 26-43% of the round trip; the rest is the agent runtime
itself, and a large part of *that* is provider process startup and CLI
overhead, not model thinking.

## Stage decomposition (clock-skew corrected)

Stages relative to the wake signal's server timestamp (T0 = signal persisted
in Space DO, which is also the moment the message is visible in Web):

| Stage | What happens | W1 | W2 | W3 |
|---|---|---|---|---|
| A | Signal persisted → dispatch first seen by dispatch ledger | 3.35 | 5.07 | 3.19 |
| B | Dispatch → runtime coordinator execution created | 1.62 | 3.79 | 2.68 |
| C | Coordinator → local daemon `deliver.received` | ~0.5 | ~0.4 | ~0.4 |
| D | Local preflight/context prep → `runtime_invocation_started` | 6.07 | 1.23 | 1.05 |
| E | **Agent execution** (invocation → completed_local) | **37.84** | **16.18** | **34.77** |
| F | Result → cloud result inbox (`resultInbox.acceptedAt`) | ~0.1 | ~0 | ~0.1 |
| G | Inbox accepted → reply signal persisted (visible) | 1.44 | 1.71 | 5.23 |
| | **Total** | 50.9 | 28.2 | 47.4 |

### Stage A (3.2-5.1s): queue-backed dispatch outbox path, no artificial delay

Verified in code: `publishTextSignalUseCase`
(`services/core/src/space/application/space-signal-service.ts:193`) calls
`waitUntil(flushPendingOutboxQueue())` immediately after persisting the
signal — the 15s `SPACE_OUTBOX_ALARM_REDRIVE_INTERVAL_MS` alarm is only the
redrive fallback, and pending outbox records are eligible immediately
(`dispatch-outbox-repo.ts:506` — no time filter on `pending`). The dispatch
queue consumer is configured with `max_batch_timeout: 0`
(`services/core/wrangler.jsonc`).

The measured 3-5s is therefore on the queue-backed hot path: outbox candidate
decision, queue produce/deliver, consumer start, and first dispatch-ledger
write. This report does not prove that Cloudflare Queue delivery alone accounts
for the full delay; it proves there is no visible 15s alarm or batch-timeout
constant causing it. Cutting this stage requires architecture work, such as a
direct Space DO → dispatch pipeline call with the queue retained for durable
redrive.

### Stage B (1.6-3.8s): multi-hop dispatch → coordinator

Queue consumer → `runtime-coordinator-client` HTTP calls (`decide`,
`head/accept`) → runtime-transport-hub DO → execution created. Several
sequential DO/HTTP round trips; no single timer dominates.

### Stage C (~0.4-0.7s): hub → daemon WS push — already fast.

### Stage D: local prep — controller-dependent

- Codex / OpenCode (`localRuntimeContextStatus: reuse`): 1.0-1.2s.
- Claude Code (W1): **6.1s**, of which `runtime_context_ready` alone took
  4.6s and the ledger context came back `recreate` with
  `bootstrapReason: compatibility_recreate` — the wake rebuilt the session
  context instead of resuming.

### Stage E: inside "agent execution" — most of it is not model thinking

Claude Code (W1, 37.8s total from invocation to completed_local):

| Segment | Duration |
|---|---|
| Process spawn → first session event (headless claude startup) | **~9.9s** |
| Space Entry Brief + attachments assembly | ~4.4s |
| Model turn 1 (decides to run `date`) | ~4.3s |
| `date` command via Bash tool | ~3.4s |
| Model turn 2 (composes reply, emits space action) | ~9.4s |
| `openmeld space action reply` CLI execution | ~3.6s |
| Runtime wrap-up to completed_local | ~1.5s |

Codex (W3, 34.8s total):

| Segment | Duration |
|---|---|
| Codex task start | ~5.6s |
| Turn context / thread restore (567k-token rollout thread) | ~7.5s |
| Model turn 1 + `date` (exec itself 0.018s) | ~5.2s |
| Model turn 2 (reply text) | ~4.0s |
| `openmeld space action reply` CLI execution | **11.7s** (wall time logged by Codex) |
| Final-answer turn (after reply already submitted) | ~4.0s, off critical path |

The same `openmeld space action reply` call took **0.43s** in the 15:05 reference
sample — the CLI has a heavy tail (Node/npx startup, local context read,
action-record write), not a constant cost. Two of four observed space-action
calls were ≥3.6s. The command writes a dispatch-scoped local action record; it
does not directly publish the visible Space reply. RuntimeCoordinator
finalization and Space publication still own final visibility. Follow-up
instrumentation in `b6541fdc5` adds structured stderr timing phases for reply
commands so future samples can separate process/module startup, context read,
target resolution, and local record write.

Notable: in W1 the agent already had the answer (the `date` output) at
T0+23s, but the user saw the reply at T0+50.9s — reply composition,
publish CLI, and the return pipeline consumed the remaining ~28s.

### Stage G (1.4-5.2s): inbox → visible reply

`resultInbox.acceptedAt` is effectively instant after the daemon sends the
result (F≈0). The lag to `replySignal.createdAt` is the finalization chain:
hub → finalization command → Space DO `finalizeAcceptedDispatchResult` →
reply signal persisted + broadcast. W3's 5.2s shows this path has a tail.

## Duplicate result delivery (found in passing, no user-visible cost)

Two of the three controlled wakes showed the daemon outbox flushing the same
result twice before the cloud `result.accepted` receipt removed the local
outbox record:

- W1 acked in 3.7s after the first result flush and did **not** duplicate.
- W2 acked in 8.1s; the local outbox flushed again at +5.5s, and one accept
  attempt was rejected with `execution_token_terminal_late`.
- W3 acked in 9.0s; the local outbox flushed again at +9.0s, and one accept
  attempt was rejected with `execution_token_terminal_late`.

The baseline issue was not user-visible correctness or latency; the cloud
correctly rejected the late duplicate. The cost was deterministic waste when
the accepted receipt loop ran longer than the local retry eligibility window:
extra frame, extra cloud accept cycle, and noisy journals. The first remediation
landed in `1d7475ce3`: successful result sends now use a 15s ack-pending grace
window, while true local send failures still retry quickly.

## Optimization candidates, ordered by leverage

Transport-side (the fixed ~12.6s tax):

1. **Stage A+B (5-9s): hot-path dispatch without the queue hop.** Space DO
   already knows the dispatch message at persist time; calling the dispatch
   pipeline / coordinator directly (queue retained as redrive fallback)
   removes the queue delivery latency and one serialization of hops. This is
   the single biggest transport win and is architecture-level work.
2. **Stage G (1.4-5.2s): publish the reply signal on inbox-accept.** The
   result payload is already validated at inbox time; finalization
   bookkeeping could follow the visible write instead of preceding it.
3. **Stage D for claude-code (6.1s): make wake resume, not recreate.**
   `compatibility_recreate` forces bootstrap re-injection and a 4.6s
   runtime-context rebuild on every wake. Investigate why compatibility
   checks invalidate the existing context.
4. **Outbox receipt loop: keep ack-pending retry slower than the receipt
   loop.** The local 15s ack-pending grace window landed in `1d7475ce3`.
   A deeper architecture option is acking on the durable inbox-accept boundary
   instead of waiting for the full visible-reply finalization loop.

Agent-side (the 16-38s execution):

5. **Headless provider startup: ~10s of the Claude Code wake is process
   spawn.** A pre-warmed or pooled headless session (or a lighter entry
   path) would cut every claude-code wake by several seconds.
6. **`openmeld space action` CLI tail latency (0.4s → 11.7s spread).** Use the
   `b6541fdc5` timing phases to profile startup, context read, target
   resolution, and local action-record write. If the heavy tail remains outside
   the local record write, consider a daemon-local fast path; submitting a
   dispatch-scoped result from the same machine should not need multi-second
   setup work.
7. **Codex thread restore cost (7.5s) grows with rollout size** (567k
   tokens in this binding's thread). Long-lived wake bindings will keep
   getting slower; consider trimming/summarizing restored context for wake
   turns.
8. **Dispatch prompt shape:** both agents spent a second model turn
   composing the reply after the tool result. A dispatch brief that
   encourages answer+publish in a single turn saves one full model round
   trip per wake.

## Limitations

- n=3 controlled + 2 reference wakes, one machine, one Space, healthy warm
  service; no cold-daemon or offline-recovery cases.
- Clock-skew correction is bounded (±0.2s) by the receipt-pair method.
- Short-task scenario by design: for long agent tasks the transport tax
  amortizes; for interactive back-and-forth it dominates perceived
  responsiveness.
- OpenCode agent-internal breakdown unavailable (no local session record
  found); its journal-level numbers are complete.

## Re-test after first optimization batch (2026-07-03 03:18 UTC)

Three production Wakes, same Space, same question, sent back-to-back within
one minute (unlike the baseline's serial spacing — so this run includes
concurrent-dispatch pressure). CLI 0.7.97 deployed with `1d7475ce3` (ack-wait
outbox backoff) and `b6541fdc5`/`d430e0c75` (space-action timing).

| Controller | Baseline e2e | Re-test e2e | Delta |
|---|---|---|---|
| Claude Code | 50.9s | **20.3s** | **-60%** |
| OpenCode | 28.2s | **22.6s** | -20% |
| Codex | 47.4s | **42.3s** | -11% |

Stage-level movement (baseline → re-test, same-controller comparison):

- **Duplicate delivery eliminated.** All three results: single outbox flush,
  single `accepted`, zero `execution_token_terminal_late`. The ack-pending
  backoff split (`ACK_PENDING_BACKOFF_MS = [15s, 30s, 60s]`) works as
  designed.
- **Claude Code context reuse.** `localRuntimeContextStatus: reuse`,
  `bootstrapShouldInject: false` (baseline: `compatibility_recreate` +
  inject). Stage D 6.07 → **0.54s**; Stage E 37.8 → **13.6s** (process
  start ~9.9 → ~3.0s, single model turn to `date`, space-action CLI
  3.6 → 0.71s). The baseline's recreate appears to be a
  post-version-bump one-off, not the steady state — the baseline report
  overstated it as constant.
- **Stage A+B faster and reordered.** Signal → coordinator execution:
  4.97/8.85/5.87 → 3.19/4.53/6.22. In two of three traces
  `runtimeCoordinatorHeadLifecycle.createdAt` now precedes
  `dispatch.firstSeenAt` (baseline: always after), indicating pipeline
  reordering/parallelization on the dispatch path.
- **Result upload is earlier.** `resultInbox.acceptedAt` now lands 2.0-2.5s
  before the daemon's `completed_local` journal event (baseline gap
  0.9-1.1s ≈ clock skew alone). Bounded skew (deliver-vs-execution pairs
  give δ ≤ 1.9s) proves part of this is a genuinely earlier result send,
  not clock drift.
- **space-action CLI tail did not recur:** 0.62s (Codex) and 0.71s
  (Claude Code) this round. Timing diagnostics from `b6541fdc5` are now in
  place for when it does.
- **Not moved: Stage G** (inbox → visible reply): 2.98 / 3.43 / 5.32s —
  now the single largest transport item. Stage D for Codex spiked to 3.93s
  in this run (send_target_reference 3.8s) under three concurrent local
  dispatches; watch whether it recurs outside concurrency.
- Codex Stage E remains 27.2s, dominated by ~18.6s of task start + 567k-token
  thread restore + first model turn; its reply-turn and CLI costs are now
  small.

Transport tax per wake: 13.1/12.1/12.6s → **6.6 / 8.9 / 15.2s**
(Claude/OpenCode/Codex; the Codex figure carries the concurrent-run D and G
tails). Updated leverage order: 1) Stage G publish-on-accept, 2) remaining
A+B queue-path latency, 3) Codex thread-restore cost, 4) concurrent local
prep contention.

Re-test dispatch IDs: `2695eaa2-16e9-4a28-8090-fa3505abf45a` (claude-code),
`e7fffe1a-426a-4709-bafa-de29053ce784` (opencode),
`86c5dd62-0b5c-4d29-b864-53d547670324` (codex).

## Cold-profile first-wake baseline (2026-07-03 03:36-03:44 UTC)

Three freshly created agent profiles (wake-test-claude / wake-test-codex /
wake-test-opencode-v4), never woken before, woken serially with the same
question. This measures the first-wake path: `localRuntimeContextStatus:
recreate` + `bootstrapShouldInject: true` on all three (as expected — the
07-03 re-test's `reuse` is the steady state, recreate is the first-wake and
post-upgrade shape).

| Controller | Cold e2e | Warm e2e (same day) | Cold penalty | Where the penalty lives |
|---|---|---|---|---|
| claude-code | **36.9s** | 20.3s | +16.6s | Stage A +4.2s, send_target_reference cold cache 6.6s, bootstrap-inject + CLI in E |
| codex | **184.6s** (≈121s excl. disconnect) | 42.3s | **+79s** (excl. disconnect) | **codex process cold start 61s** + first-run space-action CLI 13.3s |
| opencode | **27.1s** | 22.6s | +4.5s | small: A ~6s, E +4.5s |

Cold-specific findings:

1. **The cold penalty is wildly uneven across controllers.** OpenCode barely
   notices (+4.5s); claude-code pays ~17s; codex pays ~79s. A new user's
   first wake experience depends almost entirely on which controller they
   picked.
2. **Codex process cold start is 61s** (invocation → `task_started` in the
   new rollout; warm: 4-5.6s). First spawn in a fresh profile workspace
   dominates everything else in the system. The follow-up space-action CLI
   call also hit its heavy tail (13.3s wall time — first run in that
   workspace). Interestingly the model layer got smarter: it inlined
   `$(date)` into the reply command and finished in a single turn.
3. **claude-code cold start is healthy**: process start 2.9s (same as warm
   3.0s) — confirming the 07-02 baseline's 9.9s startup was environmental,
   not intrinsic to recreate. The cold cost is bootstrap-injection tokens
   and the CLI call (2.4s vs 0.7s warm).
4. **`send_target_reference` is a Space-scoped cache.** The first cold wake
   paid 6.6s to load it; the second and third cold profiles in the same
   Space got it in 3.0s and 1.0s.
5. **Stage A is slower for never-woken profiles**: 6.2-7.4s vs 2.1-5.1s
   warm — first-wake binding/readiness evaluation appears to cost an extra
   ~3-4s in the cloud decision path.
6. Checking → Available for the three new profiles resolved within a few
   minutes of creation without manual repair (exact creation timestamps not
   captured; UI observation only).

### Incident captured in passing: half-open WS drop + push loss + recovery

During the codex cold wake a real production incident window was captured
end-to-end:

- 03:38:13 coordinator pushed the dispatch; the daemon WS was half-open
  (push lost, nothing in the local journal).
- 03:38:53 daemon detected the drop (`daemon stream closed (code=1006)`),
  reconnect began 03:39:03, online 03:39:16 (~55s total unavailability
  from push loss to recovery — detection latency ~40s dominates).
- **03:39:18 the hub re-created the attempt and redelivered — 1.9s after
  reconnect.** Recovery is event-driven (register/replace on reconnect),
  not poll-driven; the mechanism works and is fast once the reconnect
  happens.
- During the disconnect window the Web Members panel flipped both
  claude-code profiles to **"Connect — Local setup is incomplete"** even
  though one of them had successfully replied seconds earlier. The copy is
  misleading: local setup was fine; the connection was momentarily down.
  It recovered to Available after reconnect without user action.

Leverage from the incident: (a) faster half-open detection on the daemon
stream (the ~40s detection window is the bulk of the outage; compare the
Space-client PONG-watchdog work), (b) honest "reconnecting" copy instead of
"Local setup is incomplete" for transient route loss.

### Updated leverage order after both rounds

1. Codex cold spawn (61s) — investigate what first-run-in-workspace does
   (app-server spawn, trust/config, model handshake) and whether it can be
   pre-warmed at profile-binding time instead of first-wake time.
2. Stage G publish-on-accept (1.8-5.3s on every wake, warm or cold).
3. Stage A for first wakes (extra ~3-4s) + remaining queue-path A+B.
4. space-action CLI heavy tail (13.3s seen again on first run; timing
   instrumentation from `b6541fdc5` should now capture phases).
5. Daemon-stream half-open detection (availability, not latency).

Cold dispatch IDs: `1893f11d-…` (claude), `579f3794-…` (codex, disconnect
window), `0152359d-…` (opencode).

## Raw data

- Dispatch IDs: W1 `b691d6e5-6e27-4718-bef2-de10d382649f`,
  W2 `37851270-77e5-4536-adf1-68787de507df`,
  W3 `66b017f2-5155-4a99-b054-006e5f7c3c34`.
- Wake signal IDs: W1 `ea055eb0-4592-4b72-9f88-5afb1ecaeb6d`,
  W2 (see history around ts 1783007571462),
  W3 (ts 1783007703276).
- Local journal: `~/.openmeld/runtime/daemon/logs/daemon-dispatch-journal.jsonl`.
- Traces retrievable via
  `openmeld service trace --space 3152fe53… --dispatch <id> --view agent --details`.
