# Agent Transport Contract

## Agent Context

- Purpose: Define the OpenMeld Agent Transport contract: how a Space Wake reaches the
  correct local Agent and returns one reply, explicit stopped outcome, or
  explicit failure to the Space.
- Read this when: You are changing Agent execution readiness, local-agent setup,
  OpenMeld Service readiness, Space Wake readiness, Wake failure copy, recovery
  planning, service lifecycle, wakeability, dispatch trace, or answerability
  logic.
- Update this when: Core ownership, execution truth, readiness semantics, Wake
  finalization, or diagnostic contracts change.
- Do not use this for: Product object semantics, Space collaboration details,
  Agent Profile identity, local OpenMeld Service lifecycle, data ownership,
  observability field catalogs, shared schema implementation, client
  presentation, temporary rollout plans, local debugging notes, raw traces,
  backlog ideas, or implementation details that belong in source code.
- Source of truth: This file owns the durable Agent Transport contract for the
  main Web Wake -> RuntimeCoordinator -> local OpenMeld Service -> local Agent ->
  Space visible outcome chain.

## Transport Promise

Agent Transport is the closed loop that lets humans and Agents collaborate in a
cloud Space, Wake the right Runtime across devices and clients, and receive one
coherent reply, one explicit stopped outcome, or one explicit failure.

The product promise is not setup, readiness, binding, route sync, service
status, or diagnostics. Those are internal evidence. The product promise is:

```text
Web or CLI Space message -> Wake dispatch -> RuntimeCoordinator execution -> local OpenMeld Service execution -> Space reply, stopped outcome, or explicit failure
```

This file owns only the transport contract: execution authority, readiness, Wake
execution, and final outcome boundaries. Product semantics, local service
lifecycle, data/observability, shared schemas, and client presentation remain
owned by their scoped `developing/` documents.

## Ownership Model

The Agent Transport contract composes stable truths. It does not replace their
owners.

- Space owns membership, messages, addressing, and Space policy.
- Agent Profile owns the AI teammate identity, instructions, and continuity.
- Agent Profile Binding owns the execution connection from one Agent Profile to
  one OpenMeld Service Runtime and Agent Controller.
- Runtime owns machine identity, lane identity, heartbeat, and observed
  Agent Controller availability.
- Agent Profile Work Coordinator owns one workstation Agent Profile's current
  admission slot, bounded FIFO order, and recovery hold. It does not own the
  Wake payload or concrete execution truth.
- The Space durable dispatch outbox is the production acceptance and recovery
  conveyor for interactive Space Wakes. After the current Core-owned Binding
  preflight, a workstation Wake goes directly from that outbox to
  RuntimeCoordinator and the current local OpenMeld Service. A retryable
  workstation admission remains in the same outbox and is redriven by the
  Space alarm. An authoritatively identified hosted Center Agent may use Queue
  as a recovery transport after a retryable or outcome-ambiguous direct native
  delivery. Queue also remains the conveyor for its other queue message
  families; it is not RuntimeCoordinator authority or the default workstation
  Wake admission path.
- RuntimeCoordinator owns in-flight Wake execution: route, lease, live
  Agent Controller availability, lifecycle, fencing token, retry, timeout, late
  result handling, and final execution outcome.
- OpenMeld Service is the local execution carrier and trust boundary. It carries
  accepted work to local controllers and reports local execution evidence; it
  does not own Space truth, Agent Profile identity, final readiness truth, or
  RuntimeCoordinator execution truth.
- D1 dispatch records own the durable ledger and query projection for Wake
  execution. They record what happened; they do not decide who owns an
  in-flight execution.

## Main Chain

```mermaid
flowchart LR
  A["Web or CLI posts a Space message"] --> B["Space persists the signal and addressing"]
  B --> C{"Relation"}
  C -->|"Reference"| D["No dispatch. The message is context only."]
  C -->|"Wake"| E["Core creates one Wake intent"]
  E --> F["Space durable outbox accepts the work item"]
  F --> G["Core directly asks RuntimeCoordinator to accept or dedupe it"]
  G --> G2{"Profile work slot"}
  G2 -->|"Available"| H["RuntimeCoordinator routes the work to the live OpenMeld Service"]
  G2 -->|"Occupied"| G3["Coordinator retains the Wake in Profile FIFO"]
  G3 --> G2
  H --> I["OpenMeld Service executes only with a coordinator token"]
  I --> J["Runtime reports lifecycle and one result"]
  J --> K["RuntimeCoordinator decides the final outcome"]
  K --> L["Space shows one reply, stopped outcome, or explicit failure"]
```

The workstation chain is strict:

- Wake is the only Space addressing relation that creates executable work.
- Reference addresses agents for context only.
- Agent-to-agent delivery must use Wake or Reply + Wake. A visible reply that
  merely contains a bare `@Agent Name` is not executable delivery.
- The Space durable outbox is the production reliable dispatch buffer for
  workstation Wakes. Queue is a recovery transport for authoritatively
  identified hosted Center Agent native delivery and remains available to its
  other independent message families.
- RuntimeCoordinator is the execution authority for one concrete Wake.
- OpenMeld Service is the local executor.
- One Wake reaches one final conclusion.

Space outbox redrive is bounded and target-aware. One flush admits at most 20
candidates, processes at most five target Agent Profiles concurrently, and
preserves FIFO order within one target. A candidate failure is isolated from
the other target queues. After a full batch advances successfully while more
pending records remain, the shared Space alarm schedules an immediate
continuation; retrying or poisoned work keeps the normal durable retry cadence.
The application-level outbox responsibility states are `pending`,
`handed_off`, and `cancelled`. `handed_off` means the selected transport
accepted responsibility: direct RuntimeCoordinator submission for workstation
Wake, or Queue only for the hosted recovery cases defined above. It must never
be interpreted as proof that a workstation Wake entered Cloudflare Queue.
For hosted native delivery, a Dispatch Ledger row alone is not durable
admission. A native-delivery row that is still `submitted` without either its
exact persisted worker request or a worker acknowledgement remains an
incomplete handoff. After the bounded direct grace period, the Space outbox
must redrive that same dispatch and attempt through hosted recovery instead of
retiring the outbox item or creating another attempt. If the exact worker
request is already persisted, recovery submits that frozen request directly;
it does not rebuild mutable conversation context before replay.
The direct path returns only after RuntimeCoordinator head acceptance and local
delivery acceptance have completed or produced a durable retry decision. Its
correctness must not depend on `DurableObjectState.waitUntil`, because that API
does not extend a Durable Object's lifetime.

For workstation Wakes targeting one Agent Profile, owner-sharded admission is
one current Wake plus at most 50 waiting Wakes. The order is the Durable Object
transaction acceptance order across Spaces and Direct Messages. The
Coordinator stores only identifiers and minimum scheduling metadata; the Space
outbox retains the complete payload while the head lifecycle is `queued`.
At first head acceptance, RuntimeCoordinator also freezes the secret-free
execution-target identity (`bindingId`, `configurationRevision`, Agent
Controller ref, OpenMeld Service Runtime id, and runtime kind) plus a SHA-256
fingerprint of the Space-owned dispatch payload. It does not copy or become the
owner of that payload. Promotion, alarm redrive, and reconnect reacceptance must
return this accepted snapshot so Core can combine it with the same outbox
payload. A different payload fingerprint for the same Wake lifecycle is an
authority conflict, never permission to execute newer message content.
During a rolling Core deployment, a caller that omits the snapshot cannot
reaccept a head that already owns one; RuntimeCoordinator returns the legacy-
parseable `retry_later` shape and never grants `create_execution`. A legacy
head may gain a proposed snapshot only inside the admission transaction while
it is still queued and has no linked execution or token authority. Any legacy
head that may already be executing also returns `retry_later` instead of
silently adopting or discarding the snapshot.
`profile_queue_waiting` is a D1 ledger projection, not scheduling authority.
Seeing that projection must retain the handed-off Space outbox item without
resubmitting it on an ordinary alarm.

Core gates fresh Work Coordinator admission with the same canonical
Wakeability projection used by product surfaces. Its current compatibility
identifier is `AgentExecutionReadiness`. A current blocking fact
ends as a visible pre-head no-execution outcome; it must not create a current or
queued Coordinator item. The gate reads current Core-held facts only. It does
not poll the Local Service, call a provider, scan Profiles, enumerate
owner-wide device inventories for presentation enrichment, sleep, or add a
second readiness projection to the dispatch path.

Before any accepted or promoted head can create a local execution, Core reruns
the canonical readiness and accepted-identity checks against current Profile
access, Binding, Agent Controller and configuration, workspace, Local Agent
enabled state, route, and availability. A blocking result records a durable
terminal no-execution decision for the exact existing head. It never calls head
accept again, and later reconnect, recovery, or re-enabling cannot revive that
settled Wake. Terminal promotion applies the same check to each next head, so
disabled work cannot remain hidden in FIFO and run later.

User-facing Wake progress may project explicit Profile FIFO `queued` copy only
from the Coordinator-owned head lifecycle `queued` state. Space outbox status,
Dispatch lookup status, and RuntimeCoordinator `created` or `delivery_pending`
remain neutral pre-delivery progress. They must not infer that another Wake
owns the Profile work slot, and the D1 `profile_queue_waiting` projection must
not become a second presentation authority.

When the current Wake becomes terminal, the same owner-shard transaction
releases it, selects the next queued head, and records the minimum pending
promotion marker. The normal path requests exact Space redrive immediately
after that transaction. The existing alarm retries only a promotion whose
external redrive did not complete. A repeated terminal event is idempotent and
cannot promote a second item. Route or Service `waiting` does not release the
Profile work slot.

A structured `usage_exhausted` terminal outcome is the deliberate exception to
ordinary promotion: the Coordinator retains the interrupted work identity and
holds every later Wake. A fresh reliable Usage recovery automatically starts
at most one deterministic retry-as-new-execution for that interrupted request.
The recovery report must declare the exact current Usage support-matrix version;
a legacy or mismatched Service report cannot authorize automatic continuation.
Its
successful terminal result opens the separate owner approval gate for queued
work and creates the urgent Inbox/email action. An explicit user Stop is
terminal: it never re-arms automatic continuation, and any later queued work
also remains behind owner approval. If no later work exists, the Stop clears
the recovery gate. Later Wakes, including new intent accepted after Usage
recovers, remain in FIFO behind that gate. Repeated reports and retries must
converge on the same continuation operation. A transport failure or
`outcome_unknown` while handing that deterministic operation to Space preserves
the pending or authorized identity so the next report can confirm or retry the
same operation. A request that definitively cannot be replayed safely, has
incomplete source context, no longer matches the same Profile, controller,
Binding, or configuration, or whose one continuation execution fails moves to
`continuation_needs_attention`; it cannot re-enter automatic continuation.
Initial authorization compares the exact interrupted run command's accepted
Binding, controller, and configuration revision with the current canonical Core
Binding inside the owner-shard transaction. That authorization and every
future-work settings write are ordered by the same owner shard. If a setting
write wins while the gate is pending or authorized, the same transaction moves
the exact continuation to `continuation_needs_attention` and writes its Inbox
intent before D1 settings may change. If head creation wins first, the gate is
already running; the setting may save for later work without changing the
current execution. Ordinary head admission keeps the established version 1
wire shape and adds no capability probe or preflight delay. A new cloud caller
uses a dedicated future-settings mutation RPC; an older shard that lacks it
rejects the setting write before D1 mutation instead of accepting an unsafe
half-rollout. Missing original accepted revision evidence remains inherently
unsafe and moves to `continuation_needs_attention` rather than being treated as
unchanged.
The handoff uses a dedicated owner-only Usage-continuation command with the
frozen interrupted dispatch/source identity and deterministic operation and
client-message identities. Space posts through its exactly-once client-message
writer, so repeated owner triggers resolve the same continuation instead of
creating another handoff. It does not call the public Execution Recovery
`retry_as_new_execution` action. That legacy action remains parseable but is
never enabled or executed for a user.
One idempotent Inbox item links the original Wake. The owner may skip the exact
interrupted work to resolve the gate and promote the oldest queued Wake.
The Usage report path sends candidate Profiles in stable, schema-bounded
owner-shard batches. Those transactions return only Profiles whose continuation
handoff is pending or authorized; Core must not probe every Profile Binding
with a separate recovery RPC when no recovery gate exists.
One Profile's recovery failure is isolated and recorded; it cannot abort later
healthy Profile reports in the same Service batch.

Provider-native instruction delivery is an adapter optimization inside the
local execution carrier. It must not change outbox admission,
RuntimeCoordinator ownership or lifecycle, Binding identity, Space reply
placement, or final Wake outcome. A controller's reported token usage, model
context window, cache usage, or compaction is observation only; no transport or
readiness decision may treat it as execution authority or proof that required
instructions are present.

### Auto-Relay Loop Policy

- An auto-relay chain may revisit a profile. A -> B -> A -> ... for any
  number of rounds is legitimate collaboration, not a fault. OpenMeld exists so
  Agent Profiles can collaborate without a human turn between rounds, so the
  transport never hard-blocks a loop.
- History: until 2026-06, dispatch preflight blocked any auto-relay whose
  target already appeared in `visitedProfileIds`
  (`dispatch.cycle.detected`), which killed every loop at its second
  revisit. That gate is removed on purpose; the error code remains only in
  historical dispatch records.
- `dispatchChainId`, `autoRelayDepth`, and `visitedProfileIds` plus its hash
  remain mandatory chain telemetry on every relay hop. They feed the
  dispatch trace and stay wire-protected end to end (see the visited-ids
  header rules in shared-contracts.md). Removing the gate does not remove
  the bookkeeping.
- Loop discipline is prompt-level, not transport-level: static dispatch
  prompt guidance forbids meaningless wakes (thanks, acknowledgements,
  receipt confirmations). Planned with the dynamic prompt injection system:
  escalating loop-awareness reminders driven by `autoRelayDepth` thresholds,
  owner notifications, a per-chain/per-Space pause control, and a
  machine-speed rate fuse that auto-pauses a tight runaway loop and resumes
  on one human message.
- Accepted residual risk until those land: a runaway agent loop is bounded
  only by dispatch-trace observation and manual intervention. This is a
  deliberate product decision: capable agents must be free to iterate, and
  protections must stay invisible to legitimate work.
- The only structural ceiling left is the visited-list schema maximum (256
  distinct profiles per chain). It bounds participants, not rounds: the
  visited list is a deduplicated set, so loops do not grow it.

## Execution Authority

Prepare makes a Runtime able to work. It may verify account, device, lane,
service, Agent Controller, and availability evidence. It must not create or join
a Space, choose Space members, create final Binding truth as a side effect, send
Wake, or decide execution ownership or final outcome.

Binding is explicit:

```text
GET /v1/agent-profiles/:agentProfileId/primary-binding
PUT /v1/agent-profiles/:agentProfileId/primary-binding
```

The binding target is
`Agent Profile -> openMeldServiceRuntimeId + agentControllerRef + optional agentControllerConversationId`.
Runtime identity is `owner account or owner principal + device + lane`. Do not
attach Runtime identity to a Human Profile or Agent Profile.

`agentControllerConversationId` is private Agent Controller continuity for the
target Agent Profile. It is not Space thread placement, Space membership, Runtime
identity, or execution ownership. Different Agent Profiles must not share one
Agent Controller conversation; conflicting ownership must be rejected or ignored
at Binding and local Agent Context boundaries.

RuntimeCoordinator execution follows one authority path:

1. Accept, dedupe, queue, or stop one target Wake intent at the
   RuntimeCoordinator head lifecycle boundary and Agent Profile Work
   Coordinator admission transaction.
2. Resolve the target Agent Profile, Binding, OpenMeld Service Runtime, Agent
   Controller availability evidence, owner evidence, and Space policy snapshot.
3. Reserve one current execution owner for the authoritative `openMeldServiceRuntimeId`.
4. Issue one execution token for the accepted execution.
5. Deliver the task to the live OpenMeld Service for that Runtime.
6. Accept lifecycle and result evidence only when it matches the current token.
7. Decide retry, timeout, late result handling, and final outcome in one state
   machine.
8. Project trace/audit facts to D1 and publish one Space outcome.

Important execution rules:

- A controlled OpenMeld Service update, reinstall, or repair first marks the
  current Runtime Transport route as not accepting new dispatches. The existing
  socket remains connected while owned local executions continue to report
  lifecycle/progress evidence, finish, flush their durable result outbox, and
  receive Core's durable-acceptance receipts. The Service closes the socket only
  after that drain finishes. An unexpected disconnect is not a controlled drain
  and must remain distinguishable in diagnostics.
- The lifecycle manager requests that drain through the local control plane
  before unloading the operating-system service. The request is acknowledged
  only after the current socket session has completed its drain. A deliberate
  force path may bypass this handshake, but it must retain force-stop evidence.
- A newly registered Service session on the same owner, device, and lane proves
  that process-local task ownership from a disconnected prior session cannot
  still be controlled by that prior Service. For a token-current execution with
  durable local progress but no accepted result, RuntimeCoordinator immediately
  records `runtime.local_runtime_lost`, publishes one recoverable terminal
  Space outcome, and projects the exact Agent Task terminal outcome once.
  Reconciliation is idempotent. A Wake already in `cancellation_requested`
  settles as cancelled when the task is absent; it must never be converted into
  a recoverable execution failure or resumed after the user's Stop.
- After RuntimeCoordinator accepts a Wake head, an actual route lookup may
  return `daemon.profile.pending_first_report` while the intended owner's
  OpenMeld Service is still heartbeat-fresh but has not reported that Agent
  Profile's Wake route. RuntimeCoordinator must keep that Wake in its durable
  head-waiting boundary for the existing five-minute hard deadline and redrive
  it when the route report arrives. Queue attempt count alone must not
  terminalize the Wake during this window. If the bounded wait expires, failure
  publication preserves `daemon.profile.pending_first_report` and explains that
  the Service was connected but the agent did not become ready; it must not
  normalize the outcome to `daemon.profile.offline` or tell the user to
  reconnect the Service.
- A `running` execution has no fixed total wall-clock timeout. Delivery start,
  reply finalization, and stale progress-evidence policies may have deadlines,
  but fresh accepted/running lifecycle or progress evidence keeps long-running
  Agent work alive until an explicit result, failure, cancellation, terminal
  token decision, or a stale progress-evidence policy ends it.
- The hosted Center Agent native-delivery exception follows the same liveness
  rule even though it does not enter RuntimeCoordinator. Core may bound the
  period before the Remote Agent acknowledges admission, but once the worker
  accepts a submission, elapsed wall-clock time alone cannot fail it. The
  worker owns durable `pending` / `running` / terminal execution state and
  progress timestamps until callback completion or an explicit targeted
  cancellation. Its state transitions must be atomic: a recorded cancellation
  cannot be overwritten by concurrent progress or successful completion.
- Core's accepted-delivery alarm may ask the Remote Agent to reconcile one
  exact submission, but it cannot infer or write worker execution truth. The
  Remote Agent reads Flue's durable submission projection, durably records
  a terminal worker outcome when needed, and reuses the ordinary callback path.
  Core then rereads its native-delivery ledger. A still-active submission, a
  missing mixed-version RPC receiver, or a transport error requeues the same
  probe and cannot become an elapsed-time failure.
- Remote Agent initialization remains recoverable from Flue's durable
  submission only while the exact attempt still owns the row,
  `inputAppliedAt` is absent, and the submission has attempt budget remaining.
  An initialization exception may return that row to `queued` for the same
  idempotent submission and a replacement Durable Object instance may claim it.
  Once input is applied, the attempt must complete, reconcile, or fail through
  the existing terminal path; recovery must not replay provider or tool side
  effects. AgentComputer storage is a subordinate durable capability, not
  execution truth: workspace RPC clients and exec handles have explicit
  operation-scoped disposal, while a disconnected client is reacquired against
  the same AgentComputer identity. Only deterministic pre-input materialization
  may restart from its beginning. If recovery exhausts the attempt budget, the
  Remote Agent callback sweep may terminalize only from Flue's durable
  `settled` row plus its structured error fact; a merely queued, running,
  terminalizing, or successfully settled row is not failure evidence.
- Hosted direct-first transport is allowed only after the Space durable outbox
  write and an authoritative Core Binding preflight confirms
  `hosted_center_agent`. If that check no longer holds, or direct admission
  needs retry, Core enqueues the exact same idempotent dispatch. Queue recovery
  must resume the native-delivery ledger/request; it must not fork the Wake into
  RuntimeCoordinator or create a second worker submission.
- Local adapter process watchdogs default to `null`. If a caller supplies a
  positive process timeout, it is an explicit diagnostic or test backstop, not
  the product's normal Agent execution policy.
- A provider protocol startup handshake may have its own bounded deadline
  before any provider thread or turn request begins. The adapter may retry that
  exact startup once only when the typed failure proves no provider turn or
  user-visible side effect started. This startup boundary must be cleared as
  soon as initialization succeeds; it must never become a total Agent execution
  deadline or retry a turn whose outcome may be ambiguous.
- `accepted_local` means OpenMeld Service has accepted the task on the user's
  computer. If the runtime has not started yet, the local service must attach
  queue diagnostics so Trace can explain whether the task is waiting for the
  same local execution lane, global local capacity, or runtime startup. A
  controller with an official atomic provider-admission contract remains
  `accepted_local` after local process startup until that provider accepts the
  exact turn; process spawn, protocol stdout, and conversation occupancy are
  not `running` evidence.
- A provider's versioned Agent Controller conversation occupancy contract may
  keep the current Wake at the Profile FIFO head after local execution starts.
  A structured occupied admission is non-terminal: the Service reports it as
  lifecycle evidence, waits for the official release signal, and retries the
  same provider admission. It must not submit a result, promote the next Wake,
  infer occupancy from Agent Activity, or classify generic transport failures
  as busy. A recovery alarm may retry after a missed signal, but it is not the
  normal availability loop. Wake Stop must cancel this wait immediately and
  fence every later provider-admission retry for the stopped task. Missing
  provider release evidence uses bounded backoff and must not become a tight
  retry loop. User-facing Wake progress may project this exact occupancy as a
  neutral wait reason, but must not call it running or expose the controller
  conversation id.
- While a Wake remains occupied or resumes running after an occupancy
  transition, the first keepalive in its current lifecycle phase, the first
  keepalive on a new connection generation, and a low-frequency recovery
  keepalive repeat the current occupancy value. Ordinary keepalives between
  them stay compatible with an older Core. A lost transition or Service
  reconnect therefore self-heals without adding a provider query to the Wake
  hot path.
- Compatibility claim endpoints may exist during migration, but they must not
  become a second execution authority.
- Caller authority, owner evidence, Binding evidence, and execution truth come
  from verified Gateway/Core context, not request-body trust.
- Before RuntimeCoordinator links an execution, OpenMeld-owned pre-agent Stop may
  move the target Wake head lifecycle to `stopped_before_execution`. That is a
  stopped terminal outcome for the target Wake, not a failed execution and not a
  controller cancel. Outbox redrive, queue consumers, head accept, delivery
  preparation, token issuance, and late local result handling must all fail
  closed against that guard.
- Deleting an Agent Profile is an execution-lifecycle event. The authoritative
  deletion fanout asks that Profile owner's RuntimeCoordinator shard to stop
  every matching unlinked accepted or waiting Wake head and every matching
  in-flight execution. Historical result-received executions are not active
  cancellation targets. Core disables the exact owner/Profile Binding so no new route
  survives the deleted identity. Space removes the Agent member only after
  cancellation is accepted or the shard proves no matching Wake is active. An
  incomplete cancellation keeps retry evidence in the Space
  membership-liveness alarm instead of leaving a removed Agent with an
  indefinitely active Wake presentation.
- Space access authority must stay structured across the Wake path. When Core,
  Space, dispatch, or RuntimeCoordinator code carries a `SpaceAccessContext`, it
  must preserve the access actor kind through internal RPC and direct Durable
  Object calls. `OpenMeldRequestContext` plus Space password is a wire projection for
  external HTTP boundaries, not a substitute for structured Space access. Losing
  a `dispatch_continuation` actor turns a narrowly authorized Wake continuation
  into an ordinary authenticated request and breaks authorization, trace, and
  stopped-outcome diagnostics. Automatic recovery must rebuild that actor from
  the Coordinator's exact interrupted dispatch, source Signal, Space, and target
  Profile identity. After Space verifies the trace, the replayed Wake preserves
  the source Signal's author; the Agent owner's Human context is never presented
  as the original message author. During a rolling Core deployment, an older
  owner shard may temporarily omit the source Signal identity. A newer caller
  must defer before any Space side effect and retry the same deterministic
  continuation only after the complete identity is available.

### Local Agent Human Interaction

A blocking local-agent request is a substate of one running
RuntimeCoordinator execution:

```text
provider turn requests input
-> Local OpenMeld Service reports one bounded interaction request
-> RuntimeCoordinator persists the pending substate
-> Binding owner reads and answers it through the originating Space
-> RuntimeCoordinator delivers the response to the same Service execution
-> the same provider turn continues
```

RuntimeCoordinator is the single cloud owner of pending, responded, delivered,
expired, cancelled, and terminal interaction state. Space and Gateway authorize
and forward reads or responses; the Local Service carries request and response
frames; D1 remains a terminal/diagnostic ledger and must not become an
interaction queue or approval store.

Every request and response is fenced by the current execution token, execution
identity, daemon session, connection generation, lease, task, dispatch,
attempt, RuntimeCoordinator execution, Space, source signal, and target Agent
Profile. A response must also name the exact interaction id. Missing or
mismatched authority fails closed.

Only the Binding owner receives the private request and may respond. Other
authenticated Space members may receive a content-free waiting summary.
RuntimeCoordinator stores the response before attempting delivery, retries it
after a socket replacement, and accepts an exact repeated response
idempotently. A conflicting repeat is rejected. Local Service owns one
process-lifetime pending registry across socket reconnects and serializes
provider requests so only one is visible per execution at a time.

An unresolved request pauses the ordinary stale-progress watchdog until its
bounded expiry, at most eight hours. After a response is stored, delivery must
complete within the bounded response-delivery watchdog; a disconnected Service
must not leave a responded execution alive forever. Delivery acknowledgement
resumes normal progress evidence. Wake Stop or provider cancellation clears the
pending substate and interrupts the same provider turn. A Service process loss
may fail the turn; OpenMeld must not claim it can reconstruct a provider process
from the cloud interaction record.

The optional Computer file access boundary uses the same interaction authority
only when local admission cannot prove that the selected controller can enforce
the exact boundary. The request is private to the Computer owner, even when a
different Organization member initiated the Wake, and offers only an
exact-execution exception or cancel. It must not become a stored approval, a
profile override, or a reason to interrupt default-policy runs. A working
folder that is provably outside the active boundary is a deterministic denied
outcome and does not ask the owner to reconsider the policy on every Wake.

### Runtime Transport And RuntimeCoordinator Boundary

Current production topology has these Core Durable Objects:

| Binding                        | Class                 | Ownership                                                                                                                                    |
| ------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENMELD_SPACES`              | `Space`               | Space conversation, membership, and Space-local truth.                                                                                       |
| `OPENMELD_RUNTIME_TRANSPORT`   | `RuntimeTransportHub` | Local OpenMeld Service WebSocket/session/route/service-liveness transport, plus the in-process RuntimeCoordinator authority described below. |
| `OPENMELD_PREPARE_SESSION_HUB` | `PrepareSessionHub`   | Setup and reconnect Prepare Session state.                                                                                                   |

There is no separate `RuntimeCoordinatorHub` Durable Object today. The
RuntimeCoordinator application modules are in-process boundaries inside
`RuntimeTransportHub`, not a physical service or Durable Object split.

The Cloudflare v4 migration renames the historical `DaemonHub` class to
`RuntimeTransportHub` while preserving existing Durable Object storage. Keep the
historical v2 `DaemonHub` migration entry and the v4 `renamed_classes` entry.
Do not use `deleted_classes` for this data. Plain old code/config redeploy is
not a safe rollback after the class rename; rollback would require a new
forward migration tag that renames `RuntimeTransportHub` back to `DaemonHub`.

`RuntimeTransportHub` remains the daemon socket/session/route/service-liveness
owner. RuntimeCoordinator authority owns the concrete Wake execution state
machine, token authority, retry decisions, and final outcome. These facts are
separate and must not collapse into one availability source:

- Service liveness: whether the local OpenMeld Service recently heartbeated.
- Route/socket delivery: whether Core currently has a usable delivery route.
- Execution readiness: whether the Agent Profile is eligible for a Wake now.
- Concrete Wake outcome: what happened to one actual Wake execution.

Canonical Agent Profile Organization identity is part of claim eligibility.
When a readiness request has an active Organization and an enabled primary
Binding, Core must verify that the Agent Profile's `organizationId` equals the
active Organization. Missing or unavailable identity evidence blocks readiness
with an explicit `agent_profile.organization_*` reason. Route, service health,
Space membership, or a legacy authorization record must not override that
fail-closed result.

The same rule applies before Wake dispatch. A foreign ordinary workstation or
managed Center Agent Profile must fail closed even if a legacy authorization
record, Space membership, route, and healthy Runtime already exist. Remote
Agent native delivery remains a separate runtime family; it does not make an
ordinary workstation Profile portable.

The 2026-06 Runtime Transport cleanup completed the practical transport
boundary work: Gateway no longer runs a long-lived daemon-stream frame relay,
the live daemon stream is owned by Core's `RuntimeTransportHub`, the Core
binding is `OPENMELD_RUNTIME_TRANSPORT`, and the public local component release
manifest requires the compatible service contract.

`RuntimeTransportHub.alarm()` is still the single shared scheduler. It
multiplexes RuntimeCoordinator finalization retry, Local Agent stream-closure
presentation repair, watchdog, accepted-head timeout-escalation, head-waiting
deadline, head failure-publication retry, pre-execution handoff, and daemon
housekeeping work. The alarm orchestration for those RuntimeCoordinator phases
has been extracted into application processors, but the authority writers
remain in `RuntimeTransportHub`.

Do not infer that RuntimeCoordinator has been physically split because files are
named `runtime-coordinator-*`. Those files are in-process orchestration and
authority helpers. Do not casually move RuntimeCoordinator HTTP handlers,
authority writers, finalization outcome writes, publication blockers, D1
projections, diagnostic events, readiness impact writes, token diagnostics,
route lookup, delivery, wait-result, socket, session, or service-liveness code.
Those boundaries need explicit ports and one clear writer before extraction.

#### Current Coupling Map

Treat the current scheduler as this coupling map:

- Daemon housekeeping reaps leases, restores/adopts socket-backed service
  runtime records, and keeps route/session/service-liveness evidence current.
  It depends on RuntimeTransportHub transport state, Durable Object storage,
  hibernated sockets, route catalogs, sessions, leases, and service liveness.
  It stays in `RuntimeTransportHub`.
- Finalization retry orchestration is extracted, but the writer remains in
  `RuntimeTransportHub`. It reads finalization commands, retry indexes, token
  authority, execution records, and dispatch facts, then writes finalization
  outcomes, terminal projections, publication references, retry state, blockers,
  and diagnostics. Do not create a second finalization writer.
- Watchdog orchestration is extracted, but the execution-progress decision
  writer remains in `RuntimeTransportHub`. It reads run command state, token
  authority, progress evidence, and execution records. It may write terminal
  outcomes, readiness-impact evidence, diagnostic events, projections, and the
  next alarm requirement.
- Accepted-head delivery path is not just an alarm. It reads head lifecycle and
  accepted-head records, resolves current route/session/service-liveness
  evidence, delivers work to the local OpenMeld Service, and waits for
  delivery/result evidence. This path stays coupled to Runtime Transport until
  delivery, wait-result, and route/session facts are represented by explicit
  transport ports.
- Accepted-head timeout-escalation alarm orchestration is extracted. The head
  lifecycle writer remains the single `recordRuntimeCoordinatorHeadWaiting`
  path, so the head moves from `accepted` to `waiting` through one writer.
- Head-waiting deadline alarm orchestration is extracted. The write-and-publish
  choreography remains in `RuntimeTransportHub`, preserving one writer for head
  lifecycle, failure publication, readiness-impact, projection, and diagnostics.
- Head failure-publication retry alarm orchestration is extracted. The Space
  failure publication, publication outcome, D1 projection, readiness-impact,
  diagnostics, and retry/exhaustion writers remain in `RuntimeTransportHub`.
- Pre-execution handoff alarm orchestration is extracted. Handoff record writes,
  publication status writes, result references, ops decisions, and retry alarm
  state remain behind `RuntimeTransportHub` writer ports.

#### Physical Split Gate

A physical RuntimeCoordinator Durable Object split is not the default next step.
It should be reconsidered only if production evidence shows that the shared
`RuntimeTransportHub` is a real bottleneck or reliability risk, and only after
RuntimeCoordinator authority can operate through explicit transport ports
instead of private socket/session/route state.

Splitting too early adds cross-Durable-Object communication to the Wake path:

```text
Space -> RuntimeCoordinatorHub -> RuntimeTransportHub -> local OpenMeld Service
```

That extra hop would require cross-object idempotency, handoff, retry, lease,
alarm, and rollback design. It may improve isolation later, but it is not
automatically faster or more reliable than the current in-process boundary.

Gateway daemon-stream pass-through is the current transport topology. Gateway
keeps the public authenticated `/v1/daemon/stream` endpoint and keeps Core
internal-only. It authenticates the request, forwards the resolved OpenMeld context
headers to Core, and returns Core's WebSocket upgrade response without accepting
a local WebSocket or pumping frames between two sockets. Core and
`RuntimeTransportHub` own the upgraded WebSocket after the
Gateway-authenticated handshake is forwarded.

### Expected Routes Projection

"Which Agent Profile routes should this device carry now" is a device-scoped
Binding projection, answered by one Core-owned read:

```text
GET /v1/local-runtime/expected-routes?deviceId=<deviceId>&lane=<lane>
```

- The unversioned response and negotiated `v2` preserve their existing strict
  shapes. `contractVersion=v3` adds the Binding `configurationRevision`.
  `contractVersion=v4` also adds the current Auth-owned `defaultProjectId`
  (`null` means the Profile workspace applies). A new local component
  negotiates newest first and falls back only on `invalid_payload`; network and
  server failures are not compatibility fallbacks.
- The owner comes from the verified auth principal; cross-owner reads are
  forbidden. Core resolves `deviceId` + `lane` through the runtime registry to
  the authoritative `openMeldServiceRuntimeId`.
- Eligibility is decided server side. An expected route requires an
  `enabled_primary` Binding, an active Agent Profile, and an
  `executionTarget.openMeldServiceRuntimeId` equal to the resolved runtime. Runtime
  scoping is a server-side guarantee: a Binding that points at another runtime
  is excluded as `binding.other_runtime`, never returned as a local route.
- `excludedProfiles` is diagnostic evidence only. It explains why a profile is
  not expected; it must not participate in availability decisions.
- Runtime resolution failure is a device-level fact. `runtimeResolution`
  `missing` or `conflict` returns `200` with both lists empty and only the
  top-level signal. It is never expanded into per-profile exclusions, and
  consumers map it to service-level reasons, not per-profile skip reasons.
- When profile facts are temporarily unavailable, the whole read fails with
  `503`. The projection must never degrade a lookup failure into
  `profile.inactive`: consumers keep their current catalog on a failed read,
  while a false inactive would deregister live routes.
- The projection is a read. It is not lease, registration, or deregistration
  authority. After a rebind, the next read stops including the route;
  in-flight lease arbitration stays with Runtime Transport.
- Controller-native execution setting writes increment the primary Binding's
  monotonic `configurationRevision`. RuntimeCoordinator freezes the current
  `bindingId`, revision, Agent Controller ref, and OpenMeld Service Runtime id
  for each accepted dispatch. Core rechecks that the current primary Binding
  and live route still own that accepted identity before delivery; a later
  Binding/controller/runtime replacement fails closed instead of lending its
  route or execution token to the older Wake. A capability-aware local Service
  reports the identity it has applied, and Runtime Transport must not deliver
  the dispatch until both Binding id and revision match. When the applied
  revision is merely older for the same Binding id, Runtime Transport may hold
  delivery inside a bounded convergence window while nudging the Service to
  re-sync, but it never executes with a mismatched identity; an expired window
  fails closed with `daemon.profile.configuration_not_synced`. This consistency
  fence does not make the projection or the Service an execution authority.
  Agent Controller Permission Mode is the only supported active-session
  reconciliation inside that frozen dispatch identity. The canonical Binding
  write and expected-routes projection remain the source of truth; the local
  Service may ask the already-active adapter to apply the new mode, and records
  it as applied to that task only after an explicit adapter acknowledgement.
  The acknowledgement means later provider tool requests use the new mode. It
  does not change the frozen Binding revision, dispatch identity, execution
  target, or a permission request that was already waiting. Unsupported
  adapters, unsupported controller modes, and repair-only permission
  constraints keep the active task's starting mode without blocking catalog
  convergence or future work.
- A v4-capable Service reports one path-free working-folder observation per
  Profile in `LocalWakeRouteReport`. The observation echoes `profileId`,
  `bindingId`, `configurationRevision`, and `defaultProjectId`, identifies
  whether resolution used the Default Project or Profile workspace, and carries
  the local Project `bindingGeneration` (as
  `localProjectBindingGeneration`) when applicable. The Core trust matcher
  accepts the set only while those current identities match and every
  observation is fresh. The Core-owned Wakeability projection consumes that
  matcher as its current working-folder gate; missing, legacy, partial, stale,
  duplicated, or identity-mismatched evidence remains unknown and fails closed.
  `localProjectBindingGeneration` is an opaque Service-owned local connection
  identity. Core does not compare it with a cloud generation; a later accepted
  current-session report replaces the earlier generation and triggers
  re-evaluation.
  Missing or invalid facts use the precise Project/workspace reason codes from
  the shared schema; local folder paths never cross the Service boundary.
  Historical Wake outcomes never substitute for this current observation.
- Controller target changes, Controller unbinding, and local working-folder
  changes use an owner-sharded RuntimeCoordinator execution-state read that
  spans every Space. Web may use that read to disable disruptive actions
  immediately, but it is advisory. The mutation writer must acquire a
  short-lived execution-target mutation admission from the same owner shard and
  hold it across its D1 or local Service mutation. RuntimeCoordinator stores
  Wake-head acceptance, active execution references, and execution-target
  mutation admission through one transactionally coordinated owner-shard model:
  `active` blocks admission, and a new Wake that arrives after admission
  receives a retryable response instead of being accepted against the changing
  target. D1 remains Binding storage, never in-flight execution authority.
  Unavailable or rebuilding owner-shard authority fails closed. A definitive
  mutation result releases admission; timeout or invalid-response outcomes keep
  the lease until expiry because the local write may still complete. Settings-
  only writes do not use this guard because they do not change execution
  identity; the permission-mode exception above is reconciled through the
  existing catalog signal and explicit adapter capability. The Core-internal
  schema names describe execution-target
  mutation, while the Durable Object RPC wire retains the historical
  `rpc*AgentProfileControllerMutation` names so old and new Worker and shard
  code remain mutually callable during eventual deployment propagation.
- An Agent Profile's authoritative owner is the canonical Binding owner and
  RuntimeCoordinator shard owner. Its authoritative workspace is the exact
  `openmeld_profiles.organization_id` recorded when the Profile is created.
  Administrative action does not transfer either identity. Every per-Profile
  Binding read or mutation and every local working-folder mutation verifies the
  active workspace against that canonical Organization before reading local
  execution configuration, acquiring mutation admission, or writing. If legacy data
  contains enabled Bindings for one Agent Profile under more than one owner,
  reconciliation must acquire mutation admission on every affected owner
  shard. Exact legacy disables and canonical target installation or reuse are
  one D1 batch so a failed target write leaves every prior enabled Binding
  intact. Organization Wake authorization is not part of Binding
  reconciliation.
  The D1 Binding writer is the final mixed-version fence: it rejects a new or
  re-enabled primary Binding whose owner is not the Agent Profile owner, and it
  rejects a second enabled primary Binding for the same Profile. Installing
  that fence preserves existing legacy rows so Core can reconcile them under
  every affected RuntimeCoordinator shard instead of changing ownership during
  migration. Profile-wide owner discovery uses a bounded, profile-first index
  and fails before admission or mutation when operator review is required.
- The owner shard keeps bounded per-profile active references plus a
  generation-bound active-profile projection and co-writes them with canonical
  head and execution-token authority. Before the bounded model is ready, or
  after a detectable ready-state inconsistency, it repairs from paginated
  canonical storage keys without trusting the legacy head or run-command
  indexes. Collection and page-apply failures share the same fail-closed,
  backoff-based state machine. Reference overflow is explicit and bounded, and
  the ready-state hot path never scans total account history.
- Removing a visibly settled execution head does not release duplicate
  protection. The deterministic terminal execution-token authority rejects an
  exact head and dispatch replay before admission; D1 history may explain the
  old Wake but cannot authorize or reject execution.
- Consumers use the response inside one operation and must not persist it.
- Device-scoped derivations (daemon route catalog, projected controllers,
  local service demand) must consume this projection instead of rebuilding the
  owner-level answer from per-profile `/primary-binding` fan-out — the same
  no-fan-out discipline as batch readiness. The per-profile Binding read
  remains for single-profile surfaces.
- The projection does not replace the compatibility `AgentExecutionReadiness`
  or `AgentWakeAvailability` implementations. Final Wakeability stays with the
  Wakeability contract, and `execution-readiness/batch` keeps serving the
  current display contract during migration; its
  response intentionally lacks Binding execution-target fields, so it cannot
  substitute for this projection either.

History: until 2026-06 every device-scoped derivation fanned out per-profile
Binding reads; one nine-profile status snapshot issued 27 cloud requests (19
of them Binding reads) in 12.8s. With the projection the same snapshot issues
7 requests in 5.2s with identical projected routes.

### Heartbeat Route Reconciliation

Server-side heartbeat route reconciliation is Runtime Transport housekeeping,
not a second route-catalog authority.

On register, heartbeat, and explicit route-catalog changed nudges, Core may
compare the service's fresh reported route leases and daemon-accounted skipped
profiles against the current expected-routes projection. If the daemon has not
reported a route it is still expected to carry, Runtime Transport may send one
bounded route-catalog changed nudge to the service so the local catalog can
converge.

Rules:

- Reconciliation must use the Core-owned expected-routes projection for the
  intended owner, device, and lane.
- Daemon-accounted skipped or rejected profiles satisfy the reconciliation
  check. They may explain local state; they do not make the profile Wake-ready.
- Reconciliation must be throttled and fingerprinted so a stale or intentionally
  skipped route does not create a heartbeat-to-nudge loop.
- A route-catalog changed nudge is a refresh signal only. It must not register
  a route, reserve a lease, accept Wake work, or change final readiness by
  itself.

## Wakeability Contract

Core-owned Wakeability is the current answer to whether an Agent Profile can
accept a new Wake in the requested context. The current compatibility schema
and endpoints call this projection `AgentExecutionReadiness`; consumers must not
treat that identifier as another concept. Product surfaces render the positive
verdict as `Available`.

```text
This Agent Profile can reply in this Space from the intended Runtime now.
```

Route online is not enough. Binding existence is not enough. Completed Prepare
evidence is not enough. Process health is not business readiness.

Core-owned Wakeability is the only final user-facing projection for this
question. Web, CLI, Space, and Start render it; they do not recompute it.

Current Wakeability and one concrete Wake execution are separate facts.
Wakeability is a current reply-path projection. A Wake execution is what
happened to one user request. A current `Available` verdict must not hide
a real Wake failure, and a real Wake failure must be preserved as
execution/diagnostic evidence instead of being rewritten as generic Wakeability
drift.

Core may project `Unavailable` before a new Wake when the exact current Agent
Controller report contains a reliable, fresh Usage Limit that explicitly says
Usage is exhausted. When the shared versioned Local Agent capability matrix
declares native Usage support, a missing, stale, expired, unavailable, or
otherwise unconfirmed current observation projects `Checking` and rejects new
Wake admission. Core and the Local Service must consume that same matrix.
Explicitly unsupported Usage and Local Agents whose Usage reporting is passive
or not evaluated do not use Usage as an admission condition. A provider-scoped
controller is filtered by the provider prefix of the Binding's selected model
before this verdict is computed. A supported selected provider therefore fails
closed on missing or unconfirmed evidence, while an exhausted unselected
provider cannot block that Agent Profile. A Binding whose provider cannot be
resolved remains compatible and does not gain a guessed Usage admission
condition. An ACI report
declares the matrix it implements through
`usageLimitsSupportMatrixVersion`. If that optional field is absent, Core
treats the report as a parseable legacy contract, but it cannot authorize new
work for a controller whose reviewed matrix requires native Usage. Missing,
mismatched, or unconfirmed Usage fails closed as bounded `Checking`. A
percentage alone, low-capacity warning, generic quota wording, or ordinary
transient `429` is never proof of exhaustion. Core derives all three outcomes
from the already-held structured report and does not call the provider on the
Wake hot path.

The same exact-version rule gates Usage recovery after an accepted Wake. A
legacy report remains parseable, but it neither authorizes a new Wake nor
triggers automatic continuation under a newer Core capability matrix.

After a Wake is accepted, a provider failure changes later Wakeability only
when the result carries fresh structured hard-blocker evidence for the exact
Agent Profile, Binding, device, runtime lane, OpenMeld Service Runtime, Agent
Controller, and provider. Organization access disabled, subscription access
unavailable, and exhausted hard quota/credit capacity may project
`Unavailable`. A later accepted success for the same exact execution identity
may clear only evidence no newer than that success. Core durably retains the
latest accepted-result watermark even when no failure row existed, so a delayed
older failure cannot reopen cleared evidence. Accepted-result time is the
persisted ordering key; an exact-time success/failure tie fails closed in favor
of the hard failure, while delayed failures and successes cannot overwrite
newer accepted facts.

The current compatibility read paths are:

```text
GET  /v1/agent-profiles/:agentProfileId/execution-readiness
POST /v1/agent-profiles/execution-readiness/batch
```

List and recovery surfaces must use the batch path. The batch path resolves
all requested profiles' route evidence through one Runtime Transport round trip.
Readiness surfaces must not fan out one route lookup per profile; that pattern
overloads the per-account Durable Object and collapses every verdict into
`Checking`.

### Agent Wakeability Invalidation Lifecycle

`agent.readiness.invalidated` is a compatibility refresh signal for Core-owned
Wakeability read models. It is not state and is not Wakeability truth.

Core may publish the frame after facts that feed readiness change, including
Binding writes, route catalog convergence, lease reaping, service liveness
changes, local component update evidence, or other owner-owned readiness inputs.
The frame should identify the affected Space and Agent Profile IDs, and its
version must be monotonic within the Space so clients can reason about ordering.

Clients may broadcast the frame locally across app surfaces and coalesce
profile IDs before refreshing active readiness, local-runtime, Binding display,
or Organization Directory caches that embed those Core-owned readiness facts.
They must then read the owning snapshots or readiness projections. They must not
derive membership, Wakeability, Binding state, local service liveness, or
execution outcome directly from the frame.

A missed frame must be recoverable by the next snapshot/readiness read. A frame
with no affected Agent Profile IDs should be ignored instead of causing a broad
refresh.

### Deleted Profile Identity Verdict

The auth owner's `profile.not_found` answer for a profile id is an
authoritative identity verdict, not a diagnostic observation. When readiness
carries `agent_profile.not_found`, availability must render a terminal
`Removed` state ("This agent profile no longer exists.") and must never map it
to a repair-flavored action such as connect, reconnect, or update — nothing on
any computer can repair a deleted profile.

A transient identity lookup failure (`agent_profile.identity_lookup_failed`,
auth unreachable) is not that verdict. It stays on the unknown/check paths and
must never be rendered or acted on as a deletion.

## Service Online Evidence

"Is this account's service online on this device" is a heartbeat-freshness
question. Runtime Transport persists one ServiceRuntime record per (account, device)
in Durable Object storage on every register and heartbeat; a service is online
while that record's last heartbeat is inside the freshness TTL. The TTL must
comfortably exceed the client's adaptive heartbeat ceiling plus one slow round
trip, so ordinary latency cannot reap live leases. One accepted final heartbeat
with `acceptingDispatches=false` and `stopCause=user_stop` is stronger evidence:
owner-Service connectivity must report that explicitly stopped session offline
immediately even while its retained diagnostic record is still fresh. A
controlled Service update and an unexpected network disconnect keep the normal
freshness window so update handoff and transient transport loss do not recreate
connected/offline flicker.

Socket presence is delivery evidence, not online evidence. Delivery (route
lookup for an actual Wake dispatch) requires a live socket; the online verdict
must not, because hibernation makes socket references transient by design.
When a delivery socket disappears but the service lease is still fresh (a recent
heartbeat within the TTL), Runtime Transport holds the affected Agent Profile
route on `Checking`: the lease is liveness evidence that the service is online
and only the socket is mid-replacement. The route settles on `Offline` only once
the lease is reaped past the freshness TTL. Offline is decided by lease
reaping/freshness TTL, not by delivery reconnect window expiry, because socket
references are transient by design.

Computer connectivity must also stay separate from current-device routing. A
connected computer with no Agent Profile Binding is still connected. Web,
onboarding, setup, and recovery surfaces that answer "is this account's service
online on this computer" must use ServiceRuntime liveness evidence such as
`/v1/local-runtimes` or current local-runtime reply-readiness. The
Binding-derived current-device answer (`/v1/devices/current`) is routing
evidence for the account's current execution target; it must not be used as
the connected-computer or service-online verdict.

Stale local evidence (for example an aged Agent Controller report) is
diagnostic input. It explains; it does not decide public availability.
Account, Binding, route, service, and provider-account facts decide.

An Agent Profile may display `Available` only when aligned evidence
exists for the profile, Binding, intended account, Runtime, lane, capability,
route, OpenMeld Service execution compatibility, RuntimeCoordinator claim
eligibility, and recent Wake diagnostics.

Public Wakeability uses one four-verdict model:

- `Available`: the full reply path is aligned now.
- `Checking`: OpenMeld is refreshing or missing enough evidence to decide.
- `Offline`: OpenMeld has stable evidence that the selected local service or route is
  not running or not online.
- `Unavailable`: OpenMeld has stable evidence that setup, binding, controller,
  provider, compatibility, or claim eligibility is invalid for Wake.

`Checking` is a bounded transient, not a stable sink: it is valid only while
evidence is actively refreshing, and must resolve to `Offline` once
ServiceRuntime liveness is stably offline. When a route lookup is offline
(`online:false`) and no wake-route report yet covers the profile, split the
registration verdict by lease freshness -- the same heartbeat signal the
route-status projection uses: a still-fresh lease (socket mid-replacement, e.g. a
transient Cloudflare-side 1006 drop) stays `Checking`; a reaped lease (no fresh
`lastHeartbeatMs` past the TTL) is stable liveness evidence the service is
offline and must resolve to a terminal `Offline`. The wake-route registration
and route-status projections must apply this split identically, so a stopped
service settles on `Offline` instead of stranding the badge on `Checking`.
`lastHeartbeatMs` on a route lookup is per-profile route-lease freshness, not
generic owner-service liveness. A newly bound or newly added Agent Profile may
have no per-profile route lease yet even while the owner's OpenMeld Service session
is fresh. Runtime Transport must project that as explicit owner-service evidence
for a pending first report, and Core readiness may map it to `Checking` only
after the service evidence still matches the intended owner, device, and lane.
If that owner-service evidence is absent or mismatched, readiness must fail
closed to stable Offline/Unavailable instead of inventing availability.
Pending-first-report evidence is also time-bounded. Runtime Transport may keep
the profile on `Checking` for at most one route lease TTL after the first
observed pending-first-report lookup. If the local service remains online but
still has not reported, skipped, rejected, or leased that profile by then, the
lookup must stop returning pending-first-report owner-service evidence and
readiness must fail closed instead of keeping a permanent `Checking` state.
Web, CLI, and Desktop surfaces must consume the Core-owned projection for this
public verdict; they may keep refreshing diagnostics, but they must not repaint a
Core-owned `Offline` or `Unavailable` verdict as `Checking`.

Owner-only recovery surfaces may show concrete actions such as `Update OpenMeld
on Computer`, `Reconnect Computer`, `Connect local agent`, or `Wrong account`.
Those actions are repair guidance, not additional public availability states.

Internal terms such as runtime, claim, route, lease, and binding belong in
diagnostics, not primary user copy.

## Wake Outcome Contract

Space Message Addressing has exactly three current relations:

| Relation      | Target support     | Dispatches work |
| ------------- | ------------------ | --------------- |
| Wake          | Agent Profile only | Yes             |
| Reference     | Agent Profile only | No              |
| Human Mention | Human Profile only | No              |

Canonical message envelope fields stay stable:

- Wake: `activationTargets`
- Reference: `referenceTargets`
- Human Mention: `mentionTargets`

Every visible `activationTargets` entry on an authoritative system final signal
must have a prepared durable dispatch handoff seed in the same Space write
plan. If the planner cannot prepare that seed, Space rejects the signal before
publication. A same-profile Wake may wait behind an existing local conversation
lane, but it must never appear in Space without a real dispatch.

Historical signals that used the retired CC relation are normalized at the
centralized shared-schema compatibility boundary. During the mixed-version
window, an unversioned authoring request that puts an active Human Profile in
`referenceTargets` is translated to Human Mention before current validation;
current callers cannot author a Human Reference. Neither compatibility path
creates executable work or enters dispatch.

Runtime results use the Space action contract:

- Use `post_message` for answers, discussion, and final replies.
- Use `post_status` only for explicit work-state updates.
- `post_status.text` is capped at 120 characters.
- Never use `ready` as a status.
- Keep the final Space action aligned to the current source message, requested
  action, performed action, and intended reply placement. Source alignment is a
  correctness contract, not a rigid rule that every external tool result must
  always return to one fixed thread.
- Protected Spaces use the same password-aware publication path for previews,
  hints, and final replies.
- Dispatch-owned local runtimes record their final outcome through the
  dispatch-scoped OpenMeld Space Action record. Supported controllers receive
  first-party structured action tools; the `openmeld space action ...` CLI is
  the fallback and attachment surface. Both use the same record writer.
  Model-authored answer text never creates or substitutes for a Space action,
  even when it looks like JSON, a tool call, or a former protocol marker. If no
  supported action entry point can record a valid action, the Wake fails with
  structured diagnostic evidence.
- A current local runtime attaches the newest relevant Space signal it observed
  to `post_message.observedThroughSignalId`. This is provider-neutral: Codex,
  Claude Code, Cursor, Grok Build, OpenCode, and future controllers use the same Space
  action boundary rather than provider-specific coordination prompts.

ACP is an adapter transport, not a second execution lane. Cursor and Grok Build
may share JSON-RPC/session/process mechanics inside adapter core, but each
adapter owns its vendor launch, authentication, model, interaction, and error
contract. RuntimeCoordinator still sees one provider-neutral Wake lifecycle.
For Grok Build, a Stop must run native session cancellation and close followed
by supervised process-tree cleanup before the Service reports the explicit
stopped outcome.

For a multi-target Wake, the per-turn Dispatch Brief may state the exact number
and profile IDs of activated Agent Profiles and point the Agent to the
source-message-scoped `space updates` read projection when its answer depends
on another target's current outcome. That context does not assign work, claim
that an activated Agent contributed, or summarize unrelated room history.
Single-target Wakes do not receive this multi-target context.

Immediately before accepting a local `post_message` action, OpenMeld Service
reads at most 20 newer, non-transient public text or status signals and Wake-
closing system notices from the originating main timeline or thread. Agent and
system signals must both name an Agent Profile activated by the source message
and reply to that exact source message; newer human messages remain relevant.
A sibling Agent's reply, failure, stopped outcome, or silent outcome is
coordination context, not proof that the current Agent's work is wrong. If that
bounded delta is empty,
the proposed action carries the current observation cursor without another
controller turn. If the delta is non-empty, Service continues the exact same
Agent Controller conversation in repair mode with only the previous proposed
action and the bounded newer messages. It reads again after that turn whenever
Space atomically reports that collaboration advanced again.
The earlier dispatch-scoped Space Action remains an unpublished, replaceable
proposal even if its local command reported that OpenMeld accepted it. The
repair turn must state that distinction explicitly: only final publication
consumes the Agent's one public reply for the Wake.
Those turns may replace only the final Space action; they must not repeat tools,
completed work, or external side effects. Each previously recorded action is
preserved as superseded evidence. Missing exact-conversation identity fails
explicitly instead of starting a fresh conversation. There is no semantic
review-count limit: a fixed count can discard a valid result in a legitimately
busy business workflow. Context remains bounded because every review reads at
most 20 signals, bounds each rendered signal, and advances from the last
observed Space cursor. RuntimeCoordinator Stop, execution authority, and real
transport failure remain the terminal controls; context review is not a new
Wake, retry of external work, or unbounded transcript replay.

An unavailable pre-publication read records diagnostic evidence and carries the
dispatch source signal as the conservative observation cursor. The Space atomic
check remains the final safety boundary and rejects the action if collaboration
actually changed. This optimization helps later-finishing parallel Agents adapt;
it does not serialize execution or replace explicit Center Agent delegation and
Agent Task Coordination when work needs planned ownership, completion barriers,
or parent synthesis.

### Agent Transport Space Action Delivery

`Agent Transport Space Action Delivery` is the canonical delivery boundary from
an accepted RuntimeCoordinator result to the Space Final Visible Outcome.

It handles Agent-authored Space actions after RuntimeCoordinator accepts a local
execution result and Core resolves the result into a publication plan:

```text
RuntimeCoordinator accepted result
-> Core resolves the Space action publication plan
-> Agent Transport Space Action Delivery
-> Space Durable Object publishes the final signal
-> space_signals + space_final_reply_claims record the visible outcome
```

This boundary exists because Agent execution results are not ordinary human
Space posts. They must preserve RuntimeCoordinator finalization authority,
dispatch identity, target Agent Profile identity, protected Space access, thread
placement, duplicate final-output prevention, persistence, broadcast, and
diagnostic evidence in one place.

The delivery boundary supports final `post_message`, `post_status`, and
OpenMeld-generated `signal.system_notice` outcomes such as `terminal_failure`,
`policy_blocked`, and `stay_silent`. `post_message` becomes a final text signal,
`post_status` becomes a final status signal, and `stay_silent` remains a visible
system notice that closes the Wake unless a future product contract explicitly
defines a non-visible silent-close outcome.

When `post_message.observedThroughSignalId` is present, Agent Transport Space
Action Delivery carries it to the Space Durable Object. Space checks for a
newer public text or status in the same main-timeline or thread scope in the
same synchronous storage transaction that inserts the final signal. If the
observation anchor is unavailable or a newer collaboration signal exists,
Space rejects the outdated reply before persistence. The check does not queue
or serialize Agent execution; Agents continue working concurrently and only
their final public write is protected.

A final reply, final status, or Wake-closing outcome from another target of the
same source message is newer collaboration context. Service includes that
sibling outcome in the bounded review delta, and Space includes it in the
atomic write guard. The current Agent then decides whether to adapt, preserve,
or withdraw its own proposal in the same controller conversation. This does not
make sibling replies mutually exclusive: the stale proposal is replaceable and
the Wake remains running until its reviewed proposal is atomically published or
the Agent selects another valid outcome.

`terminal_failure` copy is derived from shared public failure mapping, not from
raw adapter text. Runtime results may carry full diagnostic `errorCode`,
`errorType`, and `errorMessage` evidence for trace/debugging, but Space-visible
failure notices must use whitelisted public categories with a next action.

The success fact is the Space final signal and its `space_final_reply_claims`
row. `dispatch_results` is an archive/query projection only. A Wake may choose
not to archive a result, but it must still close through the Space final signal
claim when a visible outcome is published.

Do not bypass this boundary for RuntimeCoordinator accepted result publication.
Ordinary human/client Space APIs may still post messages, status, and system
notices through their own request paths; those APIs are not the Agent Transport
finalization path. RuntimeCoordinator failure publication may have its own
Space-owned notice path, but it must still produce or observe the same Space
final claim before the Wake is considered visibly closed.

For a `post_message` result from a Service that advertises
`agentReplyContextReview: true`, the daemon result receipt is the settlement
boundary. Core first asks Space to atomically publish the proposal against its
observation cursor. A committed or already-committed publication is then
accepted into the dispatch result inbox and acknowledged. A context mismatch
returns `review_required` instead of accepting the result; Service removes only
that stale proposal from its durable outbox, keeps the same Wake and execution
token active, reads the bounded cursor delta, and resumes the exact controller
conversation.

Older Services omit the capability, so Core must not send them
`review_required`; their existing result receipt remains the durable-cloud-
acceptance boundary. Non-message outcomes also keep the existing finalization
flow. Once a result is accepted, replaying finalization and repairing task or
stream projections remain Core-owned work backed by the finalization retry
alarm, never by daemon re-sends. A persisted finalization command must never
exist without a stored outcome or a live retry entry.

Execution Recovery is an execution-level, surface-neutral capability. The
execution's owning publication pipeline freezes the authorized Space, Slack,
or Lark destination. Web, Center Agent, and other clients render the same
Core-owned capability projection and echo that exact destination when invoking
an action; they do not choose recovery truth or reroute the result. Recovery
uses the existing RuntimeCoordinator, Service result outbox, Core result inbox,
Agent Controller conversation identity, Agent Task Coordination, and
publication pipeline in this order:

1. **Replay durable result.** When the Service still has an exact
   execution-identity and result-hash match in its durable outbox, reconnect
   automatically resends that record. Core accepts it idempotently into the
   existing result inbox. No Agent Controller or model runs again.
2. **Resume exact Agent Controller conversation.** This is allowed only when
   no final result is available and Core can verify that the stored
   `agentControllerConversationId`, execution, owner, controller capability,
   and requested publication destination still match. The instruction is to
   republish the already-completed final result, never to redo the task.

A new attempt after a terminal outcome is a new Wake, not Execution Recovery.
It must enter through normal current Wakeability and admission with a new
client-message and execution identity. The legacy
`retry_as_new_execution` schema member remains parseable for mixed-version
stored projections, but current Core never enables or executes it through the
Recovery endpoint.

The Work Coordinator's automatic `usage_exhausted` continuation is not an
Execution Recovery action. It uses the owner-only continuation path described
above, so closing the public action cannot disable deterministic Usage
recovery.

An explicit user Stop is not automatically recoverable. A process crash with
no result must not fabricate completion. An external-side-effect outcome that
cannot be proven remains outcome-unknown and must not be automatically rerun.
Transport reconnect/redrive preserves the same execution identity.

If RuntimeCoordinator has already closed an execution as
`runtime.progress_stale` or `runtime.local_runtime_lost`, an exact
token-run-matching successful result may be accepted into that same dispatch
result inbox as `late_result_available`. Core publishes one idempotent recovery
notice that references the retained result without rerunning the original Wake.
It acknowledges and releases the Service's existing durable outbox record only
after that notice is durable; a notice-publication failure returns `retry_later`
so the same outbox record replays. Acceptance does not reopen
RuntimeCoordinator, publish the result as a second final reply, undo the one
authoritative visible terminal outcome, or start another controller
continuation. Cancellation, user Stop, any other terminal reason, token
mismatch, and non-successful late results remain terminal rejections.

`late_result_available` is durable recovery evidence, not a recovery command.
Core's `inspectExecutionRecovery` projection orders the two outcome-scoped
capabilities above. The idempotent `recoverExecutionResult` command passes the retained
result through the existing result/publication pipeline and records the
recovered outcome without replacing RuntimeCoordinator's terminal history.
`resumeControllerConversation` is available only after the exact-conversation
checks above. The recovery operation ledger compares the complete expected
execution identity, destination, action, and operation id before publication
or controller I/O; a duplicate exact operation returns its recorded outcome,
while a conflicting command fails closed. A setup/reconnect link, a new Wake,
or a model-written prompt must not impersonate either recovery command.
The resumed model's answer is recovered content only. Recovery completion or
failure comes from the typed controller result and exact-conversation checks,
never from a magic phrase written in that answer.

The recovery operation fence is keyed by execution identity, frozen
destination, and action rather than by a caller-generated operation id. One
claim has an attempt id and bounded lease. A stale attempt cannot complete a
newer attempt, and different caller operation ids cannot authorize parallel
publication or controller work. Before taking or retrying a lease, Core
reconciles the effect's deterministic identity against the owning result inbox,
Space publication claim, native-delivery ledger, or exact controller
submission. It records one of `safe_to_retry`, `succeeded`, or
`outcome_unknown`; it neither deletes ambiguous claims nor leaves a thrown
side effect as a permanent uninspectable `in_progress` record. Process or
Durable Object restart must reach the same decision from those authoritative
facts. The per-execution Durable Object record is an operation fence only, not
execution or result truth.

If the product-defined 24-hour finalization-repair window is exhausted,
RuntimeCoordinator asks Space to apply the exhaustion decision instead of
trusting a cross-object `unresolved` read. Inside the owning Space Durable
Object, one synchronous storage turn atomically either observes the existing
final claim or persists an explicit `terminal_failure` notice with
`failureStage: publication` and claims the same final slot. An existing final
reply or stopped notice wins. Otherwise the new visible publication-failure
claim fences every late result publication before RuntimeCoordinator records
terminal failure authority.

Core repairs the Agent Task, stream, D1 execution projection, and
RuntimeCoordinator terminal authority from the winning Space claim. A visible
reply or stopped notice remains authoritative. A visible publication-failure
claim permits the exact Space Wake Agent Task to settle as
`publication_failed`, using that notice's signal id as its published outcome;
the durably accepted agent result remains diagnostic evidence. An unavailable,
unsupported, or invalid exhaustion response remains publication-uncertain and
keeps the retry parked. This also makes a mixed-version rollout fail safe when
the Space Durable Object has not yet gained the additive RPC. Core removes the
durable finalization retry only after the relevant authority and downstream
projections agree, and after stream closure succeeds or is durably handed to
the separate stream-closure retry owner. A storage outage or interrupted alarm
therefore cannot strand a parent continuation or fallback.

For publication exhaustion, Core checks any already-recorded Agent Task outcome
before changing RuntimeCoordinator authority. It does not record a new Agent
Task outcome or release its continuation until RuntimeCoordinator terminal
authority and the Wake-evidence projection agree. The task outcome occurrence
time comes from the retry's stable first-publication-failure fact, not from the
current alarm attempt.

Rollout recovery has one narrow terminal-authority exception. If an older Core
already wrote `runtime_coordinator.publication_retry_exhausted`, the retry is
still durable, and Space proves that its existing final claim is a real reply,
RuntimeCoordinator first verifies that Agent Task Coordination either has no
task for this command or stores the same terminal outcome derived from that
reply. Only then does it repair that exact legacy false failure to
`reply_published` and emit structured reconciliation evidence. A pre-existing
`publication_failed` task outcome is an explicit reconciliation conflict: Core
keeps the retry and the legacy authority unchanged because an already-triggered
parent continuation or fallback cannot be safely undone. Cancellation, Wake
Stop, and every other terminal failure remain locked and cannot be reopened by
a late result.

Finalization replays for one RuntimeCoordinator execution use a bounded
in-process serialization window. When an earlier Space publication remains in
flight beyond that window, the Space-owned exhaustion command chooses the final
claim and defers retry exhaustion while publication is still uncertain.
Final-claim
recovery also bounds the complete downstream repair and coalesces one in-flight
repair per execution; the durable finalization retry remains until task and
execution projection repair finishes and stream closure is accepted or durably
handed to its dedicated retry. This keeps housekeeping alarms bounded without
letting a concurrent exhaustion decision overwrite a visible final result. The
claim read distinguishes a visible success or status from a visible Wake Stop;
a Wake Stop remains cancellation authority and must not be reclassified as
successful result publication.

The first-party OpenMeld Space Action tools and the
`openmeld space action ...` CLI fallback are authoring surfaces for the current
dispatch result. They use one writer to record a dispatch-scoped action for the
daemon. Neither is a Space publication API. The only publication path for that
action remains RuntimeCoordinator finalization followed by Agent Transport
Space Action Delivery.

### Local Agent Work Summary Delivery

A workstation Local Agent may report privacy-bounded tool lifecycle activity
while its RuntimeCoordinator execution is running:

```text
local agent adapter admitted semantic work
-> local OpenMeld Service daemon tool-activity frame
-> Core RuntimeCoordinator authority validation
-> Space Agent stream part
-> compact Web Work summary
```

This path is presentation evidence, not a second execution, publication, or
finalization authority. The Local OpenMeld Service maps provider-specific
events to OpenMeld-owned admitted semantic work keys and may attach only an
explicitly safe bounded subject label. It must not send tool arguments, results,
raw errors, command text, paths, file contents, or private Agent text. An event
without an admitted work meaning remains transport-observable locally but does
not become a Space work part. Core accepts a part only when the current
execution token, execution identity, daemon session, connection generation,
lease, task, authoritative Space, target Agent Profile, and source signal all
match the pending RuntimeCoordinator execution.

Core processes tool-activity and result frames in arrival order per dispatch.
The Space part RPC must finish before the matching result may retire execution
authority or begin finalization. This ordering is dispatch-scoped: heartbeat
handling and unrelated dispatches must not wait behind one slow Space stream
write, and a rejected activity frame must not poison later result handling.

Space remains the only owner of stream sequence, deduplication, expiry, draft
work state, and bounded working-details retention. The final Signal carries the
complete current projection in additive `meta.agentWorkSummary` metadata and
may carry only older-schema-safe steps in legacy `meta.agentActivity`
metadata. This split keeps cached older Web clients from rejecting the final
reply while current clients retain concrete Connected App work.
RuntimeCoordinator finalization closes the exact Local Agent stream after a
final Space publication outcome is known. A retryable publication failure
leaves the bounded draft open for replay or normal expiry; it is not a final
failed stream. A successful final
message may attach the safe semantic work summary to that published Signal for
14 days;
a failed or stopped terminal discards it. If the final Space reply is published
but stream close fails, Core must preserve the published reply truth and durably
retry the exact Space stream closure. Accepted Stop, suppressed late results for
an already-stopped execution, and exhausted final-publication repair also close
the exact stream. A failed close creates only a RuntimeTransportHub-owned
presentation-repair retry on its existing bounded-work alarm; it does not reopen
execution, republish a result, change the terminal outcome, or become a second
finalization writer. The retry is idempotent and is removed only after Space
accepts the close, including an already-closed or expired projection.

One Wake produces one Final Visible Outcome: one persisted Space reply, one
explicit visible stopped outcome, or one explicit visible failure. Live reply
preview may exist as transient UI, but it is not history and it does not replace
the final message. Current readiness, service health, dispatch ledger rows,
result pointers, cancellation request delivery, and publication pointers are
evidence; they are not the Final Visible Outcome by themselves.

For a Center Agent delegation, Core durably records the initial child-Wake
publication command before it creates active child coordination. It prepares
the delegation, posts the Space signal with the same deterministic
`clientMessageId`, and activates the child only after that idempotent post is
accepted. Outcome-unknown publication is redriven by the Core scheduler; a
definite rejection cancels the prepared delegation. This outbox bridges
coordination metadata to the existing Space Wake entrypoint. It neither starts
execution directly nor becomes a second Space or RuntimeCoordinator writer.
Each publication attempt has a bounded deadline shorter than its claim lease,
so an unresponsive Space call cannot hold the scheduler indefinitely. Core
returns `publicationStatus: pending` when the command is durably queued but
Space acceptance is not yet known; that status is not a failed Wake and must
not cause an Agent to redelegate the same work. Accepted responses retain the
pre-outbox response shape so an older Remote Agent remains compatible during
the consumer-first rollout. The minute scheduler redrives already-ready parent
continuations before publication recovery, so one slow child-Wake retry cannot
delay an existing continuation loop. Publication recovery has its own
45-second batch budget, and a definite retry rejection is terminal only after
an atomic Space reconciliation by `clientMessageId` either returns the
idempotent signal or persists a rejection tombstone that fences every late
post. A stored accepted signal is returned as accepted even while a different
claim owner is still finalizing coordination.

Release this additive response contract consumer-first: deploy the shared
schema and Remote Agent parser before a Core version that may emit
`publicationStatus: pending`, and apply the shared D1 migration before that
Core version. An older Core still returns the accepted legacy shape, which the
new consumer accepts. CLI, OpenMeld Service, Skills, Gateway, and Web do not
read or write this internal Center Agent RPC response, so they require no
compatibility branch or coordinated local-component release.

### Agent Task Terminal Projection And Continuation

Every Wake terminal path that can participate in coordination projects one
bounded terminal outcome into Core-owned Agent Task Coordination:

- successful final publication;
- `stay_silent`;
- terminal execution failure;
- final-publication failure;
- `wake_stopped`, including stop before execution.

This includes a RuntimeCoordinator `failed_terminal` decision caused by stale
progress or a Service interruption. Publishing the visible failure and recording
the exact failed Agent Task are one recoverable terminal-projection workflow;
the failure must not leave a declared `resume_parent_*` subscription waiting
forever. The resumed Center Agent receives the failed outcome and recovery
context, but it does not become the child's execution authority.

This projection is downstream of the execution authority. It does not decide
that a Wake is terminal and cannot change RuntimeCoordinator state or Space
outcome truth. Recording the same Task Handle and terminal evidence again is
idempotent.

When the Task Handle has a ready completion subscription, Core claims that
subscription and creates the declared continuation. A Center Agent
continuation is a new native delivery with its own idempotency and ledger
record. It carries the exact triggering outcome, a bounded delegation snapshot,
and frozen destination rather than reopening the terminal parent. The
delegation barrier is one of `all_terminal`, `first_success`, `on_failure`, or
`on_each_terminal`. One-shot barriers atomically elect one durable ready
subscription before completing the delegation; that ready row is the recovery
point if the following completion write or Queue send is interrupted.
`on_each_terminal` uses each exact child subscription once. Core revalidates the
represented human member before admission.

A general Task Watch registers the same exact-task subscription without
creating delegation topology. The observer declares one exact Task Handle and
one completion condition; a matching authoritative outcome creates a new
Center Agent native delivery with the exact watched handle, outcome, frozen
instruction, destination, and represented requester. Registration ends the
current work loop. The runtime rejects later same-turn tool execution; the
model may emit only a bounded acknowledgement before the turn settles. The
Agent does not wait, poll, or hold a worker invocation open.

A general watch is observation, not ownership. Stopping the observer cancels
pending or claimed watch continuations but does not Stop the independent
watched task. A stopped observer also cannot register a new continuation.
Space Wake and hosted native-delivery handles support their authoritative
terminal conditions. A registered controller-native handle supports only the
conditions proven by its exact registration source and lifecycle adapter:
Claude Code `TaskCreated` supports `terminal` and `succeeded`; Claude Code
`SubagentStart`, Codex `SubagentStart`, and Codex `UserPromptSubmit` support
only neutral `terminal`; and Claude Code `SessionStart` supports no watch
condition. Current controller-native callbacks do not support `failed` or
`needs_attention` watches. Codex Stop and SubagentStop are terminal evidence,
not success evidence. Every unsupported condition fails closed before
subscription creation.

Provider callbacks travel through the authenticated Runtime Reporting path.
The Local OpenMeld Service durably queues minimized lifecycle evidence before
upload. Core verifies the current Runtime/device/owner, Organization
membership, controller/source pairing, exact prior registration, and bounded
event time before recording an observation. Duplicate event ids are
idempotent only when their immutable payload matches; conflicting reuse is a
permanent rejection. Completion registration order is recoverable: a
completion without its registration is retryable, never guessed. Generic
presence, Agent Activity, and model polling remain outside execution truth.

A fallback Agent is persisted as a planned child with a distinct exact Task
Handle. The primary failure subscription activates that child only for
`failed` or `publication_failed`; the fallback never rides the primary message
as an activation target. Fallback activation first moves the child to active,
then posts the idempotent Space Wake, so a crash can retry without duplicate
work. Primary non-failure skips the fallback and its pending subscription.

When an observer parent becomes authoritatively stopped, Core cancels its
active delegations and ready or claimed delegation and general-watch
continuations before dispatching more work. Incrementing the delegation
generation fences already-claimed delegation work.
Core forwards the ordinary exact `clientMessageId + targetProfileId` Wake Stop
request to active Space Wake children and cancels any native continuation that
was admitted before the fence became visible. A missing or identity-mismatched
execution is not accepted as cancellation proof; the durable terminal
projection remains retryable. One failed Stop target does not starve later
siblings: Core attempts every child and continuation target, then reports the
aggregate failure. Native continuation cancellation first persists the local
publication-denied terminal fence, then forwards worker cancellation. A worker
transport failure therefore cannot permit a late callback to publish, and
replay continues to retry the external Stop. This propagation uses Space,
RuntimeCoordinator, and native delivery cancellation authority; Agent Task
Coordination does not replace those authorities.

Queue delivery is a conveyor, not the coordination truth. If immediate
continuation enqueueing fails, the durable subscription remains ready. The
minute scheduler redrives ready subscriptions and expired claims. Processing
and native-delivery submission are idempotent, so a crash between claim,
enqueue, admission, and settlement cannot create multiple model turns.

For a stopped workstation Wake, RuntimeTransportHub persists the stopped
publication record and a pending terminal-projection index atomically. Its
bounded-work alarm retries the D1 projection and clears the index only after
Core accepts it. A transient Core failure therefore cannot leave a visibly
stopped child permanently invisible to its parent subscription.

Wake execution invariants:

- `dispatchId` is the logical Wake identity.
- RuntimeCoordinator execution state is the in-flight execution truth.
- Transport retry or outcome-unknown redrive must not create a new logical
  Wake. A user-selected new attempt after a true terminal failure is a new Wake
  with a new client-message identity and never an Execution Recovery action.
- Structured Space Action repair is a bounded correction attempt for the same
  logical Wake. It may fix the public delivery action, but it must not redo the
  business work or create a second source of execution truth.
- A completed Wake execution must not be delivered again as current work.
- A delivered Stop control frame does not mean the local agent has stopped.
  RuntimeCoordinator may show `cancellation_requested` while execution remains
  active. Once RuntimeCoordinator accepts a user Wake Stop intent before a
  visible reply is finalized, later success replies must be diagnostic-only and
  must not overwrite the stopped outcome. A local control accepted result may
  still confirm adapter/controller cancellation, but it is not allowed to race a
  user Stop intent against a normal reply.
- If Stop happens before execution is linked, RuntimeCoordinator must record
  `stopped_before_execution`, publish a `wake_stopped` system notice, and keep
  late dispatch, late local result, and late reply facts diagnostic-only.
- A Space Wake routed to Remote Agent native delivery must honor that same
  pre-agent stopped head before worker submission. Core checks before
  admission, checks again after the worker ACK to close the admission race,
  requests worker cancellation when the ACK lost that race, and settles a late
  callback as stopped without publishing it. The admitted submission id is
  carried across the ACK-persistence race so a worker accepted immediately
  before the local Stop fence cannot escape cancellation. Terminal projection
  failure keeps the dispatch Queue message retryable; a stopped ledger replay
  must finish that projection before it acknowledges the message.
- The Space Durable Object is the atomic final-outcome fence for this native
  path. Once its dispatch outbox is cancelled, it rejects a matching Remote
  Agent final reply with `space.final_outcome_stopped`; the callback consumer
  treats that rejection as a stopped terminal outcome, not a retryable
  publication failure. This fence does not turn the native runtime into a
  RuntimeCoordinator execution.
- A late result from an old execution token must not overwrite the current
  execution.
- A token-matching result retained after `runtime.progress_stale` may be exposed
  as recoverable evidence, but it must not replace or reopen the authoritative
  terminal execution.
- Result reporting is idempotent and must not create duplicate business output.
- Recovery paths may repair failed state. They must not become a second primary
  send path.
- Agent Task Coordination observes terminal execution facts and may create a
  new declared continuation; it never becomes a second execution authority or
  reopens a terminal Wake.

### signal.system_notice Field Contract

`signal.system_notice` data fields (schema in
`packages/schemas/src/schemas/space-mesh/signal-system-notice.ts`) have
distinct roles. Do not conflate them:

- `text` is the single human-facing field. Clients must render it directly and
  must not derive user-visible copy from any other field.
- `reason` is a legacy diagnostic supplement kept for backward compatibility.
  Clients must not classify, branch, or group on `reason`; it may change
  shape and is not a stable machine contract.
- `reasonCode` is the machine-readable public failure/notice code, drawn
  as-is from the same code family as shared public failure mapping (see
  `Public Failure Recovery Copy` in `developing/architecture/shared-contracts.md`).
  Clients use it to group notices and look up recovery guidance
  programmatically. It is never raw provider text.
- `failureStage` distinguishes, for a failure notice, whether the agent's
  execution itself did not settle (`"execution"`) or the agent's execution
  settled but OpenMeld's own reply publication broke afterward
  (`"publication"`). Both kinds can otherwise collide on the same generic
  fallback errorCode; clients must not infer this distinction by
  string-matching `reason` or `reasonCode`. It is only meaningful for failure
  outcomes; a notice with no failure (`stay_silent`, `wake_stopped`,
  `policy_blocked`) may omit it.
- `actorProfileId` and `dispatchId` are always present on a request-scoped
  final notice; a client must be able to locate the originating Agent Profile
  and dispatch from every notice.
- `replyTo` must be populated whenever the publishing path holds an upstream
  source signal snapshot for this dispatch (the common case for
  Wake-triggered request-scoped notices). A publisher only omits it when no
  such snapshot exists at that point in the pipeline (for example, a
  pre-execution lifecycle stage that never captured one) — omission is a
  documented gap, not a free choice.

### Pre-Head Terminal Dispatch Failure Receipts

A dispatch that terminalizes before RuntimeCoordinator head acceptance has no
owner-routed head channel, so the dispatch Queue layer must publish the
Space-visible `terminal_failure` system notice for it directly, for every
error code — generic copy when no specific copy exists, never silence.
Execution-stage persistent failure receipts remain owned by the
RuntimeCoordinator head finalization/publication channel, and the Queue layer
must not publish a second persistent notice for them. The pre-head receipt is
a terminalization prerequisite: if Space publication is unavailable, the
dispatch remains `failed_retryable`, the Queue or direct Space outbox retains
the same dispatch until Core has written its recovery intent, and replay uses
the same request identity. Before its first publication attempt, Core must
persist an immutable failure-publication intent
that freezes the secret-free redrive message and the complete system-notice
command: Space and dispatch identity, system actor, target actor snapshot,
request identity, failure stage and reason, public text, and reply placement.
It must not persist the Space password, source message or attachments, or
source-text preview; a retained reply pointer uses a generic preview. The same
intent owns its attempt count, next-attempt time, expiring publication claim,
and monotonically increasing state version in a dedicated Core operational
outbox. Frozen commands and mutable retry state use separate columns. This
outbox is execution recovery state, not Wake evidence or an
`ops_decisions` record, and observability retention must never delete a pending
row. Every Queue retry must detect and claim that intent before claim or
preflight and may only publish its frozen command and finish its ledger
records; a later profile, Binding, or readiness change must never turn that
failed dispatch back into executable work. The minute Core scheduler reads the
same operational outbox, scans due intents, and re-enqueues their frozen
secret-free messages, so a Queue enqueue failure or an exhausted original
message cannot strand the receipt. A successful scheduler enqueue does not
move the publication due time: the resulting Queue delivery must be able to
claim the intent immediately. Queue and scheduler redrive share the same
versioned compare-and-set publication claim, which is the only exclusion gate
for publication. Only a durable, idempotent Space receipt permits the dispatch
ledger and DLQ to become terminal.
This publication retry must not create a RuntimeCoordinator execution or
deliver work to an Agent Controller.

## Diagnostics Baseline

Every real Wake must be diagnosable from one user action.

The stable correlation key for Web-authored Wake messages is:

```text
clientMessageId
```

The operator path is:

```text
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

Trace must preserve enough evidence to connect:

- `clientMessageId`
- `sourceSignalId`
- `targetProfileId`
- `dispatchId`
- `latestAttemptId`
- `claimLeaseId`
- `bindingId`
- `openMeldServiceRuntimeId`
- `agentControllerRef`
- `agentControllerConversationId`
- `resultRef`
- `publishedSignalId`
- `replySignalId`
- Cloudflare runtime evidence when available

The canonical selector and correlation contract is the Correlation Chain in
`developing/architecture/data-and-observability.md`, with the shared schema in
`packages/schemas/src/schemas/http/observability-correlation.ts`. Trace
responses must expose
`correlation.modelVersion = "openmeld.observability.wake.v1"` and must derive
correlation fields from existing facts through
`projectObservabilityWakeCorrelation(...)`.

The current trace response must preserve the authoritative RuntimeCoordinator
head-waiting boundary. While a connected Service has not yet reported the
target Agent Profile's Wake route, that boundary includes
`daemon.profile.pending_first_report`, the hard and soft deadlines, the wait
trigger, and `wait_for_wake_route_report`. A historical dispatch-attempt error
must not replace those current facts or make Trace prescribe reconnecting the
Service.

Trace output must show absence as evidence: no source signal, no Wake target,
target not in Space, Binding missing, Runtime unavailable, capability
unavailable, execution denied, result missing, or reply not delivered.

Do not log or persist secrets, tokens, passwords, full message text, prompt
bodies, or arbitrary payload dumps.

## Owner Boundaries

Use scoped owner documents for detailed rules:

- `developing/product/product-model.md`: product promise and top-level OpenMeld
  product model.
- `developing/product/agent-profiles.md`: Agent Profile identity, Binding
  surface semantics, and reply recovery boundaries.
- `developing/product/space-collaboration.md`: Space addressing, Wake,
  Reference, threads, `post_message`, `post_status`, and visible Space
  outcome semantics.
- `developing/architecture/local-openmeld-service.md`: OpenMeld Service as local execution
  carrier, account/device/lane alignment, Prepare, service health, update
  states, and Human View / Agent View boundaries.
- `developing/architecture/data-and-observability.md`: Dispatch Ledger,
  projections, trace selectors, correlation, Diagnostic Reports, Cloudflare
  evidence, and sensitive-data boundaries.
- `developing/architecture/shared-contracts.md`: shared schemas, runtime policy,
  execution token/finalization envelopes, Binding/claim eligibility projections,
  and cross-client reuse.
- `developing/clients/web.md` and `developing/clients/cli.md`: client-specific
  presentation, setup handoff, readiness display, trace, and diagnostics
  surfaces.

## Non-Negotiable Invariants

- One truth per concept.
- One writer per object.
- Core owns final user-facing Agent execution readiness.
- Space owns Space truth.
- Runtime owns Runtime truth.
- Binding owns execution connection truth.
- RuntimeCoordinator owns in-flight Wake execution truth.
- D1 dispatch records own Wake execution ledger and query projection.
- Prepare writes Runtime readiness evidence only.
- Reference never creates dispatch work.
- A bare `@Agent Name` in prose never creates dispatch work.
- Route online never makes Wakeability `Available`.
- Process health never equals business readiness.
- Recovery never becomes the hot path.
