# Local OpenMeld Service

## Agent Context

- Purpose: Define OpenMeld Service / daemon as the local execution carrier and trust
  boundary that lets OpenMeld run local agents from cloud Spaces.
- Read this when: You are changing service install, update, repair, lifecycle,
  account alignment, device or lane alignment, runtime identity, controller
  discovery, current-device Project operations, agent controller reporting,
  dispatch delivery, result reporting, or service diagnostics.
- Update this when: OpenMeld Service ownership, daemon lifecycle, local execution
  contract, runtime identity evidence, agent controller reporting, compatibility
  policy, or service-facing user copy changes.
- Do not use this for: Agent Profile product semantics, Space collaboration
  semantics, RuntimeCoordinator state-machine details, CLI command tutorials,
  test commands, schema implementation, or general local development workflow.
- Source of truth: This file owns the durable architecture boundary for the
  local OpenMeld Service / daemon.

## Product Role

OpenMeld Service is the local execution carrier and trust boundary between OpenMeld cloud
collaboration and work performed on the user's computer.

It exists to serve the main product chain:

```text
Space Wake -> RuntimeCoordinator -> local OpenMeld Service -> local agent -> Space reply, stopped outcome, or explicit failure
```

OpenMeld Service carries accepted work to local controllers and capabilities, reports
local execution evidence, and helps OpenMeld understand whether this computer can
participate in the reply path.

When OpenMeld Service accepts a RuntimeCoordinator task locally but has not started
the runtime yet, it must report why the task is waiting. The accepted-local
state is not enough by itself. Trace and user-facing diagnostics must be able to
distinguish at least:

- waiting behind another Wake for the same local execution lane
- waiting for this computer's global local execution capacity
- starting the local runtime

Different Agent Profiles must not share the same Agent Controller conversation.
If duplicate ownership is observed locally, OpenMeld Service must treat the matching
Agent Context as invalid for execution and fail closed rather than continuing
with mixed private context. The default serial unit is the local execution lane:
the bound `agentControllerConversationId` when present, otherwise the target
Agent Profile for an unbound first run. Controller counts may still be logged as
diagnostics, but they are not the scheduling authority.

The service runner owns one local-execution-slot registry for its process
lifetime and injects that same registry into every replacement Runtime
Transport socket session. A WebSocket reconnect must not create a second empty
registry while an earlier socket's provider turn is still running; otherwise a
new Wake can bypass the local execution lane and collide with the same Agent
Controller conversation. Process restart may create a new registry because
RuntimeCoordinator separately reconciles the lost process owner.

It does not own the product outcome by itself. A running service is useful
evidence, but the product question is whether the intended Agent Profile can
reply in the intended Space through the intended local execution path.

## Ownership Boundary

OpenMeld Service may own or report local execution evidence:

- service availability
- device and lane identity evidence
- local controller and capability evidence
- accepted local execution progress and result evidence
- service diagnostics

Lifecycle-owner diagnostics are scoped to one lane. A production system service
and a dev-local system service may run on the same computer without becoming
multiple owners. `multiple_owners` means that more than one lifecycle mechanism
is controlling the same lane, such as launchd plus a direct CLI process.
For a foreground Service with an explicit `OPENMELD_HOME`, the existing
installation-root check also scopes manager ownership: a registration belonging
to another installation is not a second owner of this isolated Service.
Inventory anomalies and effective runtime status must use that same scoped
manager observation. This does not permit changing another installation's
registration or suppress multiple owners within the current installation.
A fresh running lease identifying a directly started process takes precedence
over that same PID's managed executable path when classifying lifecycle owners.
Using an installed binary does not itself mean the OS service manager started
it. Other PIDs and an actually running manager remain independent evidence.

Isolated Service smoke must use the development or Canary entry point, not
borrow the installed Production binary with a different `OPENMELD_HOME` or
environment preset. Service startup rejects that mixed launch before entering
the carrier. This guard prevents an unsupported test launch from appearing in
Production's process inventory; it is not a replacement for account, device,
runtime, connection, or same-installation duplicate-owner checks. Normal
Production startup and separately installed development/Canary lanes remain
supported. A home override alone does not prove process or remote isolation.

OpenMeld Service does not own:

- Space truth
- Agent Profile identity
- Agent Profile Binding truth
- final user-facing readiness truth
- RuntimeCoordinator execution truth
- final Space reply placement
- product-level Wake outcome authority

OpenMeld Service is the local carrier, not a second source of Space, Agent Profile,
readiness, or execution authority.

## Account, Device, And Lane Alignment

Local execution is only meaningful when OpenMeld knows which account, device, and
lane the local service represents.

A setup, repair, or handoff flow must align the intended account, computer,
lane, OpenMeld Service, local capability, and Agent Profile before it can honestly
claim the reply path is ready.

If setup starts from OpenMeld Web or another account-authorized flow, the local side
must prove it is signed in to the same OpenMeld account. Missing, unknown, or
mismatched local authentication must fail closed and give the user a clear next
action.

When local service identity is known, the flow must preserve owner account,
Agent Profile, device, and lane evidence. Core-owned checks should reject
incomplete or mismatched runtime identity instead of inferring it from Web
state.

The local service contract is account-scoped evidence. When the owner account
or target Agent Profile is known, the service contract should carry that
evidence so setup, repair, reconnect, and current-device checks can reject stale
or cross-account service reuse. Existing device or connected-computer evidence
must not be reused unless the owner account and profile evidence are trusted.

Agent Controller availability reporting depends on a valid service contract. If
required owner account, Agent Profile, device, or lane evidence is missing or
invalid, treat local Agent Controller evidence as unavailable instead of
submitting partial availability state as if the reply path were aligned.

Runtime session continuity is OpenMeld-owned. Local controller configuration should
use `OPENMELD_CLI_CONTEXT_ID` when a CLI context field is needed. Provider or
terminal-specific environment variables such as Codex, Claude, shell, tmux, or
terminal session IDs are not OpenMeld identity and must not choose the acting Agent
Profile or dispatch owner.

## Prepare Boundary

Prepare is the local Runtime readiness process.

Prepare may:

- ensure local OpenMeld Service readiness
- detect runnable local Agent Controllers
- prepare runnable Agent Controllers
- report Agent Controller availability
- reconnect a service-reported device identity to an authenticated,
  owner-verified existing Computer selected by the Prepare Session

For an ordinary Web computer handoff, authentication and verified OpenMeld
Service alignment are the blocking path. Once that Service is connected, the
product may report `Computer connected`; deep Agent Controller discovery,
controller sign-in checks, Skills alignment, diagnostics, and Project discovery
continue as non-blocking background work. An explicit terminal-side Agent
selection still prepares and reports the selected controllers before that
explicit request completes.

The Prepare owner must persist the successful Service-alignment step, including
the connected device and Runtime lane evidence, before it can complete the
session. An empty Agent Controller selection is not Service evidence and must
never skip, replace, or imply that step. A CLI-local lifecycle operation that
was not written back to the same Prepare Session cannot authorize the
`Computer connected` result.

Service-alignment evidence belongs to the Terminal connection epoch that
reported it. If a newer Terminal connection replaces or reconnects an active
Prepare Session, every Terminal-owned step is pending again and the new
connection must report its own Service identity before setup can resume. This
prevents one computer from inheriting another computer's device or lane proof.

A computer with no installed local Agent Controller is still a valid connected
computer. OpenMeld Service remains in a low-resource idle state, keeps its cloud
connection and update control plane, and periodically reconciles newly installed
runnable built-in controllers. A newly discovered controller is registered and
enabled once; an existing explicit On or Off choice is never rewritten. Missing
controllers are never a reason to stop or unregister the Service.

Lane isolation for OpenMeld-managed Agent Skills must not suppress this
read-only Agent Controller discovery. A dev, canary, or custom
`OPENMELD_HOME` may detect and register a runnable controller such as Codex
without gaining permission to inspect, link, or mutate that controller's
registry-default shared skills directory.

Prepare must not:

- create or join a Space
- create Agent Profile Binding truth as a side effect
- choose Space members
- send a Wake
- decide execution ownership
- decide final Wake outcome
- decide final user-facing Wakeability

Prepare can make the local side able to work. It cannot replace Space
membership, Binding truth, transport readiness, or RuntimeCoordinator execution
authority.

`connectedComputerId` is the stable user-visible Computer identity. `deviceId`
is service-reported device evidence. The local device identity must live outside
disposable Runtime state and survive OpenMeld Service update, repair, uninstall,
and reinstall on the same lane. It may rotate only after an explicit destructive
OpenMeld reset or when OpenMeld rejects unsafe identity evidence. Reconnect must
preserve the distinction between those identities: the trusted Prepare target
may group a replacement device identity under the existing Computer, while local
cached connected-computer state is never authority for a Web-issued reconnect.

## Agent Controller Interface

Agent Controller Interface (ACI) is the local OpenMeld Service / CLI boundary for
understanding and controlling a user's installed Agent Controllers.

ACI is not a T3-style provider-instance product model. OpenMeld does not create a
parallel virtual provider layer for users to manage. OpenMeld enhances the user's
existing local controllers. The local controller remains the user's installed
Codex, Claude Code, Grok Build, Cursor, OpenCode, or future controller; ACI is the adapter
surface OpenMeld uses to detect it, launch it, inspect it, and drive its native
control capabilities.

ACI-owned local evidence may include:

- selected launch contract and install choice
- binary/version diagnostics
- controller sign-in status and account identifier when the controller exposes
  them safely
- native control capabilities such as approvals, interrupts, model selection,
  event streaming, and structured user input
- controller-provided model, skill, or command inventory when available through
  a stable native surface
- provider-reported Usage Limits when a stable native, non-task surface exists
- clear local repair guidance when the controller is missing, ambiguous, old, or
  not authenticated

The controller-provided model inventory is compatibility evidence for that exact
selected installation and authenticated account. ACI preserves its bounded model
IDs and display names in the cloud projection so owned and team-safe Computer
reads can prevent a known-incompatible Profile selection. This does not expose
provider account identity, paths, arguments, commands, skills, or raw diagnostics.
Missing inventory is unknown evidence, not proof that every catalog model works
or that none do. Version advisory remains a separate maintenance check; an
advisory lookup failure must not erase an otherwise proven incompatibility.

The selected launch contract remains the install and update identity. When an
Agent Controller is bundled inside a host application, ACI must treat that host
application as the update owner. It must not compare the bundled runtime with a
standalone CLI package's release channel or offer that CLI package's update
command. If the host application does not expose a stable update-status
contract, ACI omits the version advisory instead of guessing across sources.

The same identity rule applies to standalone installs. Latest version and the
update command must come from the selected install's channel: that controller's
official native updater, npm/pnpm/bun, or the Homebrew formula actually
installed, including its tap. ACI must not compare a third-party tap install
with Homebrew core, and must not advertise a generic updater whose latest
source is a different package.

When an
official controller package adds a thin launcher around a packaged native
runtime, an ACI adapter may execute that native runtime directly only after it
proves the official package identity, declared entry point, platform package,
and executable path. This runtime materialization must preserve the selected
contract's arguments and managed-install environment, remain adapter-owned, and
fall back to the official entry point for unknown package layouts. It must not
rewrite Binding truth, create a second install choice, or change how upgrades
discover the user's selected controller.

ACI must not own:

- Agent Profile identity
- Agent Profile Binding truth
- Space membership or Space reply placement
- final Wakeability `Available` truth
- RuntimeCoordinator execution truth
- the user's model intent stored on a Binding

Provider Usage Limits are capacity evidence, not execution authority. Each
controller projects one optional list of stable limit keys, plain-English
labels, 0–100 used percentages, reset times when reported, observation times,
and honest states. A controller that hosts multiple model providers may also
attach the provider's stable id and display name to each limit. Those fields
group evidence; they do not carry authentication or account identity. An
adapter must leave an unknown percentage or reset time
unknown. It must never infer capacity from a failed run, start a Wake or Agent
Session to collect it, or retain credentials, account identity, subscription,
payment, balance, or monetary fields from a provider response.

The Service collects this evidence through the existing background ACI probe
or a sanitized provider-native event passively observed during an ordinary
already-running Agent Controller turn, then publishes it through the same
Runtime Agent Controller Report. Passive observation must not create a turn,
change its prompt or result, or become execution authority. Before retaining a
passive observation, the Service confirms the current account through the
controller's existing native, non-task ACI authentication probe and binds the
observation to that owner-only evidence. It never adds account identity to a
Usage Limit item. An observation with unknown account identity is discarded,
and evidence bound to a different account cannot merge into the current
snapshot. One provider failure cannot fail the Computer inventory or another
controller. A temporary failure after a valid observation preserves that
last-known percentage and reset with its original `observedAt`, marked `stale`,
only when the existing owner-only authentication evidence proves the same
provider account. An account change, signed-out state, or missing stable account
identity fails closed to the current `unavailable` evidence instead of carrying
capacity between accounts. A provider that has never returned usable evidence
is `unavailable`. A controller with no supported native source is explicitly
`unsupported`. The Service does not decide Agent Profile Wakeability, Binding,
Wake admission, RuntimeCoordinator, routing, or agent selection from these
states. Core applies the shared versioned capability matrix to the report it
already holds; it never calls the provider on the Wake hot path. The Service
stamps each current ACI report with `usageLimitsSupportMatrixVersion`; this
explicitly tells Core that missing or unconfirmed native Usage evidence must
fail closed. A legacy Service report without that optional declaration remains
valid during mixed-version rollout and does not acquire a new Usage admission
condition solely from a newer Core matrix. When retrying against an older Core
contract, the Service omits both the Usage projection and its support-matrix
declaration. For a
controller whose matrix entry declares native Usage support, a reliable fresh
`available` observation permits Usage admission, a reliable fresh explicitly
`exhausted` observation blocks the Wake as `Unavailable`, and missing, stale,
expired, unavailable, or otherwise unconfirmed evidence blocks new Wake
admission as `Checking`. A controller that explicitly reports Usage as
`unsupported`, or whose matrix entry is passive, unsupported, or not evaluated,
does not use Usage as a Wakeability condition. A separate structured
provider-access evidence field may be emitted only after an ordinary Wake is
accepted and returns a definitive account blocker: organization access
disabled, subscription access unavailable, or exhausted hard quota/credit
capacity. Authentication failure remains ACI authentication evidence. A
generic quota percentage, low-capacity warning, ordinary `429`, or temporary
provider failure must not create provider-access evidence or independently
prove exhaustion. Classifiers evaluate an explicit transient `429` or
rate-limit signal before broad textual matches such as `usage limit` or
`billing`; only structured or otherwise definitive hard capacity evidence may
override that transient classification.

Core also requires the exact current support-matrix version before a fresh
Usage report may trigger automatic continuation of interrupted work. Legacy or
mismatched reports remain compatible inventory evidence but cannot authorize
new work under a capability contract they did not implement.

OpenCode is provider-scoped. Its ordinary provider inventory names connected
providers but does not expose a universal quota contract. OpenMeld reads the
official OpenCode Go usage endpoint for that provider's 5-hour, weekly, and
monthly windows. The OpenCode Go API key is read transiently from OpenCode's
official local auth input or store, used only for that request, and never
logged, retained, or projected. Other connected OpenCode providers are
`unsupported` until a provider-owned, non-task capacity source is verified.
Failure to read OpenCode Go usage produces provider-scoped `unavailable`
evidence without failing the rest of the Computer inventory.

Provider-access evidence is provider-neutral and carries its provider, stable
reason code, observation time, and `wake_failure` source. The Service forwards
it with the exact Agent Profile, Binding, device, runtime lane, OpenMeld Service
Runtime, and Agent Controller execution identity already owned by the accepted
Wake. It must not infer or substitute any identity from another local runtime
or lane.

The local keeper avoids replacing a successful observation during one Service
process lifetime when the provider account remains proven. Core applies the
same account-bound last-good rule while accepting the next Runtime Agent
Controller Report, so a Service restart followed by a temporary provider
failure does not erase stored numeric evidence for a proven unchanged account.
This is an update to the canonical report row, not a second Usage Limit store.

Claude Code is partially supported through public Agent SDK
`rate_limit_event` messages already present in OpenMeld-launched turns. Only a
finite native utilization value and its allowlisted window/reset fields become
capacity evidence; missing ordinary utilization remains unknown. OpenMeld must
not install or replace the user's global Claude status line, invoke Claude for
collection, read Claude credentials, call a private OAuth usage endpoint, or
substitute transcript token/cost estimates.

### Agent Instruction Delivery

OpenMeld owns one provider-neutral instruction plan for every workstation Wake:
stable developer instructions, a content-derived instruction epoch, the current
Wake input, and a complete fallback prompt. Stable developer instructions may
include OpenMeld's collaboration model and built-in information-protection
guidance, including the rule that the Agent makes the final semantic working-
language choice. Current message, Space, profile, Organization policy,
attachment, action facts, and the optional Core-frozen Organization working-
language advisory remain per-turn input. A preference change therefore does not
change the stable instruction epoch. Provider adapters must not maintain a
second copy of either category or run a separate language detector/model call.

An adapter may separate the plan only through an official controller surface it
can prove. Codex App Server installs stable instructions on a new thread and
marks the thread with the exact instruction epoch. Claude Agent SDK appends them
through its system-prompt preset. OpenCode Server supplies them through the
turn's `system` field. OpenClaw Gateway supplies them through
`extraSystemPrompt`. Cursor ACP, Grok Build ACP, and every CLI fallback keep the
complete prompt because those surfaces do not expose an equivalent supported
instruction channel.

For a supported controller, the Service may inject an ephemeral first-party
Space Action tool configuration into the controller process for the active
dispatch. That configuration is not written into user settings. It exposes only
the allowed `reply`, `status`, and `stay_silent` operations, forwards the active
dispatch identity, and fails closed when the action context is absent, expired,
or mismatched. Fresh and resumed controller conversations use the same tool
boundary. Codex, Claude Code, Cursor, Grok Build, OpenCode, and OpenClaw use
their controller-native tool extension point and the same dispatch-owned action
writer. Controllers without a proven structured-tool surface continue to use
the exact dispatch-scoped CLI fallback.

OpenClaw Gateway does not expose a per-turn plugin-injection surface. During an
action-enabled dispatch, the adapter therefore runs the same OpenClaw Session
through its local CLI with a temporary first-party plugin and temporary config.
The adapter preserves the provider Session ID and the user's existing model and
tool policy, does not edit the user's config, and deletes the temporary files
after the turn. Non-dispatch OpenClaw turns keep the existing Gateway path.

When the controller finishes without one valid Space Action, the Service may
continue that exact controller conversation once with one compact delivery
repair instruction. The instruction tells the controller not to repeat the
work or change its answer and asks it to record exactly one of the allowed
actions. It includes only a bounded excerpt of the preceding output. This
repair turn does not publish by itself, create a second dispatch, or change the
Binding's controller-native permission intent.

Before a dispatch and immediately before that one repair turn, the Service may
restore the locally selected `openmeld-cli` Skill for only the active controller when its managed copy is
missing or outdated. The Service must use the active lane, hold the normal
skills lock, and leave any user-owned conflicting file untouched. Skill repair
is guidance recovery, not execution authority; a failure remains diagnostic
and must not bypass the dispatch-scoped action checks.

The same local content selection is maintained independently by the existing
maintenance worker; see [Official CLI Skill delivery](../engineering/official-cli-skill.md).
Dispatch startup performs no remote download and supplies the installed entry
path plus the public Markdown fallback. Skill content does not restart Service.

Codex resume may use the smaller per-turn input only when the `thread/resume`
response proves that `thread.threadSource` matches the exact current
instruction-epoch marker. A legacy thread, an epoch mismatch, or missing source
evidence must use the complete fallback prompt. Resume and fork do not replace a
Codex thread's developer instructions, so they must not be used to retrofit a
legacy thread.

Codex App Server resume is a bounded admission step, not the execution itself.
OpenMeld requests metadata-only resume without replaying historical turns,
because the Service needs the controller conversation identity, model, and
instruction source rather than a duplicate copy of provider history. Passive
provider-conversation proof must use the same metadata-only boundary: it must
not set approval, sandbox, model, collaboration-mode, or other turn policy on
the canonical controller conversation. Codex's official cross-process thread
writer lock makes `thread/resume` the atomic occupancy admission boundary. The
exact App Server `-32600` response `thread <id> already has an active writer`
for that resume is structured Agent Controller conversation occupancy, not a
Wake failure. OpenMeld keeps the task at the Profile FIFO head, observes the
official lock release, and retries that same metadata-only resume immediately.
A low-frequency recovery check handles a missed filesystem event or abrupt
writer exit without starting another App Server process while the official lock
still exists. If the exact lock is unexpectedly not visible after Codex reports
writer occupancy, the retry uses a short bounded backoff instead of spinning.
Wake Stop aborts the task's lock watcher and retry boundary immediately, and
that task must not issue another `thread/resume`. Normal execution adds no extra
query or network round trip. No other RPC code, message, timeout, stderr,
process presence, or Agent Activity fact may be promoted to occupancy.

Normal dispatch preserves the same ownership boundary for model selection. An
existing Codex thread with no explicit primary Binding model selection resumes
without model or reasoning overrides, so its controller-owned settings remain
unchanged. A new thread receives the catalog default. An explicit Binding
selection is user intent and remains authoritative on resume and turn start.
The Service must not inspect private Codex rollout files or global config to
infer a substitute selection.

After an occupancy transition, the Service includes the current occupancy value
on the first keepalive in its current lifecycle phase, the first keepalive after
a connection-generation change, and a low-frequency recovery keepalive. Until
`turn/start` returns the accepted turn, the Service remains `accepted_local`;
App Server process spawn, protocol stdout, and writer occupancy do not promote
RuntimeCoordinator to `running`. Ordinary keepalives between those frames omit
the additive field so an older Core can still observe fresh local ownership.
Current Core may recover a lost transition after a WebSocket reconnect or
Service restart without polling Codex or delaying normal Wake admission.

If Codex explicitly reports that an existing controller conversation is
missing, the adapter starts one fresh thread and delivers the complete current
instruction plan exactly once. The resulting context delta replaces the
inaccessible provider conversation transparently; a person must never be asked
to create a new Task or Space to repair it. A resume timeout is ambiguous: it
must fail closed while preserving the exact controller conversation id, and
must never silently replace that user-selected Session with a fresh thread.

A Codex reply-repair turn uses one ephemeral fork of the canonical controller
conversation and keeps the canonical conversation id as continuity truth. The
fork request carries the selected model, controller-native permission policy,
sandbox, and working directory. The fork response is already a live in-session
thread; OpenMeld starts the repair turn on that response directly and must not
send `thread/resume`, because an ephemeral thread intentionally has no durable
rollout to load. A missing canonical source rollout remains an explicit context
failure rather than a provider or network failure.

Control-operation deadlines are risk-specific. Metadata-only resume and
collaboration-mode lookup keep a short bound so inaccessible history rolls over
promptly. Fresh thread creation and `turn/start` acknowledgement use a longer,
still-bounded admission window because controller cold work such as local
plugin, skill, MCP, and workspace initialization can be delayed by temporary
host pressure. A fresh thread-start timeout may be retried once because no user
turn has been accepted and an unobserved thread is not a published side effect.
OpenMeld must not automatically resubmit `turn/start` after an acknowledgement
timeout: the controller may already have accepted the turn, so resubmission
could duplicate user work. Once a turn is accepted, no fixed total wall-clock
timeout applies to the healthy running execution.

The version 1 Local Agent capability matrix currently marks only Codex App
Server as `official_atomic_admission_and_release_signal`. Claude Code, Cursor,
Grok Build, OpenCode, and OpenClaw remain explicitly unsupported because the
interfaces OpenMeld consumes do not yet provide an official, deterministic
cross-process occupancy fact and release signal. Unsupported means OpenMeld
does not invent a preflight; each adapter continues to use its real provider
submission contract, and an outcome-ambiguous submission fails closed through
the existing execution reconciliation path.

Deploy the Core lifecycle receiver before publishing the matching local
component. An older Service sends no occupancy evidence to a newer Core. If a
newer Service briefly reaches an older Core, that Core may reject the one
additive occupancy lifecycle frame, but the Service continues ordinary running
keepalives, retains the same Wake locally, and retries only the provider's
official admission. The mixed-version window therefore loses the new trace
detail without failing the Wake or promoting later work; no local-component
contract floor bump is required.

Controller context fullness, token usage, cache state, or compaction must never
decide whether required instructions are present. These are diagnostic and
capacity signals, not instruction-delivery evidence. Correctness is decided by
the controller capability plus explicit instruction-epoch evidence; the
complete fallback remains the safe path when that evidence is absent.

### Computer File Access Boundary

The optional Computer file access boundary is a local Service-owned admission
policy for processes started, resumed, repaired, or recovered by OpenMeld on
one Computer. It applies across that Computer's Organizations, Agent Profiles,
Projects, Spaces, and requesters. It does not constrain a person's direct use
of Codex or another local controller, and it does not govern Service Project
discovery, Agent Activity observation, setup, or diagnostics.

The three modes are `local_agent_settings`, `only_selected_folders`, and
`block_selected_folders`. `local_agent_settings` is the default and preserves
existing behavior without a new check or prompt. An active Computer boundary
intersects with the Agent Profile's controller-native permission mode; neither
layer may widen the other. Profile, Project, Organization, and Space surfaces
must not add overrides or duplicate this policy.

Owner policy reads and writes target the explicitly selected Computer's exact
device and lane plus its live owner Service session. PeopleComputers routes
revalidate that target and never fall back to an account Binding or another
environment. The older current-Computer endpoints remain compatibility
adapters for supported clients. Web policy caches include account, device and
lane, and changing the selected environment remounts the editor so a draft
cannot cross targets. They do not require a registered or
enabled local Agent execution target: execution-target inventory governs Agent
operations, while this Computer-wide policy remains manageable whenever the
exact current Service is connected and advertises the negotiated capability.

OpenMeld uses an official controller-native restriction surface as the
enforcement mechanism. The Service compiles the provider-neutral policy through
the selected ACI adapter, verifies the exact launch contract and exact compiled
arguments, and passes them to the controller process. For Codex, the adapter
uses strict named permission profiles and `default_permissions`; it does not
attempt to inspect every tool call or reimplement Codex filesystem policy. The
Agent receives one path-free awareness instruction so it understands that the
run is intentionally bounded, but prompt text is guidance and never proof of
enforcement.

An active policy whose working folder is deterministically outside the boundary
rejects before controller launch without asking the user. If the selected
adapter cannot prove that it can enforce the exact boundary, the current Wake
pauses through the existing Agent Interaction path. Only the Computer owner may
choose **Run once without this boundary** or cancel. The exception is
bound to that execution and is never persisted as a rule. One execution creates
at most one such request; reconnect replays the same request instead of creating
another. Exact Codex capability attestations may be reused for five minutes
inside one adapter process, keyed by launch contract, compiled arguments, and
working folder, so ordinary Wakes do not spawn redundant probes.

The policy is stored atomically in the lane-local OpenMeld home with owner-only
file permissions. Every update uses the current monotonic policy revision as a
compare-and-swap precondition. The store persists the 64 most recent
idempotency-key fingerprints and original results: an exact replay returns its
original result without rewriting policy, a key collision is rejected, and an
evicted stale request cannot restore old policy because its expected revision
no longer matches. The Service remains the only policy writer and source of
state.

Absolute paths may cross Web, Gateway, Core, RuntimeTransportHub, and Service
only in the authenticated Computer owner's immediate request-response. They
must not be written to D1, Organization data, Agent Activity, cloud snapshots,
Center Agent context, browser persistence, logs, traces, or failure receipts.
Service store failures expose only stable `computer.file_access.*` codes and
path-free messages across process boundaries. The local typed error retains its
absolute store path and parse reason as non-serializable diagnostic context, so
local repair tooling can diagnose the lane-owned file without placing that path
in a receipt, trace, or log payload.

When a Codex run has an active boundary, the adapter sanitizes failures at its
single outward dispatch-result boundary for both Codex App Server and local CLI
transports. Controller stderr and provider failure text are replaced with a
stable path-free message before receipts or logs can consume them, while the
bounded error code, error type, provider-account evidence, model diagnostics,
and process telemetry remain available for debugging. Runs without a Computer
boundary retain their ordinary controller error detail.

The first ACI phase strengthens Codex, Claude Code, Grok Build, Cursor, and OpenCode without
changing Binding semantics. Codex may use the existing Codex App Server
transport for richer native status, account, model, skill, and event evidence.
Claude Code dispatch uses the Claude Agent SDK while preserving OpenMeld
launch-contract selection, Agent Profile Binding semantics, and Wake outcome
ownership. OpenCode may use its local server and SDK surfaces to prove
provider sign-in and model inventory. CLI probes may still provide install,
auth, and version evidence where they are the only stable local proof, but
machine state must come from vendor-documented structured output, exit status,
or typed protocol events. Human-readable CLI prose is diagnostic text only and
must not decide authentication or readiness. ACI should expose only facts it
can prove rather than inventing parity fields.

The local-component release contract
`openmeld-service-contract-2026-08-agent-answers-content-v1` requires a Service
that keeps Agent answer text separate from execution state. The corresponding
managed Skill contract is
`openmeld-skills-contract-2026-08-tool-owned-actions-v2`. Older Services can
misinterpret model-authored text as a Space action, so the final release must
mark Service and Skills updates as required. The Runtime Transport epoch and
wire schemas do not change: new and old cloud code can still exchange the same
typed action records while the required local update closes the unsafe writer.

The later local-component contract
`openmeld-service-contract-2026-09-codex-thread-model-v1` requires a Service
that distinguishes a new Codex thread from a resumed thread whose primary
Binding has no explicit model selection. Older Services can inject the newly
published catalog default into an existing thread and replace its controller-
owned model. The release that activates the new catalog default must therefore
mark the Service update as required. The Runtime Transport epoch and wire
schemas remain unchanged; the hard cut protects execution semantics rather than
introducing a second transport shape.

Cursor dispatch uses only the official Agent Client Protocol exposed by
`cursor-agent acp`; OpenMeld does not maintain a second Cursor print-mode
adapter. ACI detects the `cursor-agent` executable itself, never the generic
`agent` command or the presence of Cursor IDE state. It reports the CLI build,
`cursor-agent status --format json` authentication evidence, ACP as the native
interface, model selection, permission-mode selection, native event streaming,
cancellation, interruption, permission requests, structured questions, and
plan review. OpenMeld maps blocking ACP requests into the shared Agent
Interaction contract and returns the user's response on the same ACP session.
Cursor Run Everything keeps its native one-time automatic allow behavior; it
must not create a synthetic approval prompt or persist an `allow_always`
decision.

Grok Build dispatch uses the official ACP stdio surface in one supervised
process per Wake. The selected launch contract runs `grok --no-auto-update
--permission-mode <native-mode> agent --no-leader stdio`; unattended
authentication accepts only a cached token or an `xai.api_key` method and never
opens a login browser. ACI reports only the models returned by the authenticated
ACP inventory. The runtime resumes the profile's private Grok session when one
exists, validates the exact model and reasoning effort before prompting, and
keeps Headless JSON as diagnostics only rather than an execution fallback.
The process cwd and ACP session cwd use the same canonical directory and fail
before launch when it is missing or not a directory. Unknown blocking Grok ACP
client requests fail closed. ACP image/audio input remains unsupported when the
live capability says so; the separate local-file-path attachment capability
does not turn into native ACP image support.

Cursor and Grok Build share adapter-core ACP process mechanics: newline JSON-RPC
framing, pending-request ownership, lifecycle telemetry, bounded admission,
session cancellation, and process-tree supervision. Their adapters retain
vendor-specific launch, authentication, model, mode, extension-request, and
error semantics. Stop is terminal only after the adapter cancels the live ACP
session, closes it when supported, and the supervised controller process and
descendants are reaped; a successful protocol cancellation alone is not final.

Codex App Server maps current and legacy command/file approvals,
`requestUserInput`, additional-permission approval, and MCP form or URL
elicitation into the same contract. Claude Agent SDK maps `canUseTool`,
`AskUserQuestion`, `ExitPlanMode`, and MCP elicitation. OpenCode uses its local
server event stream plus official permission and question reply endpoints.
Provider abort or process exit must release any adapter-local waiter promptly.
For a Binding with `codex:plan`, the local route resolves a Plan conversation
policy, verifies the native collaboration-mode catalog, and passes the exact
Plan preset to `turn/start`. A missing or malformed Plan preset fails the turn
explicitly instead of silently starting Default. The route and route cache
retain the controller-native Collaboration Mode so restart and diagnostics do
not depend on reverse-engineering the App Server request.
For Claude plan review, the adapter gives each active provider turn its own
temporary `plansDirectory`, prefers plan text captured from that turn's stream
or `Write` call, and then reads only that isolated directory as the fallback.
It must never scan the user's shared `~/.claude/plans` directory, because a
concurrent Claude session could otherwise expose or approve the wrong plan.

Cursor CLI sign-in is separate from Cursor IDE sign-in. Local setup directs the
user to `cursor-agent login`, and Service readiness must be based on credentials
that the Service process can actually use. `AGENT_CLI_CREDENTIAL_STORE=file`
may be offered only as an explicit diagnostic escape hatch for environments
where macOS Keychain access is unavailable; it stores credentials outside the
Keychain and must never become a silent automatic fallback.

ACI must distinguish a completed negative result from a check that did not
complete. A completed check may prove that a controller needs repair or is not
authenticated. A timeout, local-server startup failure, transport interruption,
or other incomplete check proves only that the current check failed. The
snapshot records that failure explicitly, preserves the timestamp of the last
successful check while the selected command fingerprint remains stable, and
keeps the controller's current status unknown. It must not relabel the
controller as needing setup or discard the last successful evidence.

An installed or detected controller that cannot currently launch must remain
visible with explicit repair evidence; it must not be relabeled as missing or
silently removed from local-agent selection and diagnostics.

Provider process startup and provider task execution are separate lifecycle
phases. An adapter may bound and retry a protocol initialization handshake only
while it can prove that no provider thread or turn request began. Once provider
initialization succeeds, ordinary long-running work remains governed by fresh
execution progress, explicit cancellation, and terminal results rather than a
fixed wall-clock deadline.

Controller snapshots are local evidence. They may power Computer cards, CLI
diagnostics, Desktop surfaces, and owner-self Agent details, but they must stay
separate from Core-owned Wake readiness. A controller can be installed and
signed in while a specific Agent Profile is still not wakeable because Binding,
account, runtime lane, claim eligibility, service compatibility, Space
membership, or RuntimeCoordinator evidence is missing.

When ACI evidence leaves the local process, it must travel through the shared
runtime reporting contract and the Core local runtimes read model. Web, Desktop,
and other clients should consume the projected `listLocalRuntimes` capability
snapshot instead of probing Codex or Claude Code themselves.

The local registry's `enabled` state is a real process-access boundary. Routine
inventory may passively detect an executable for every supported controller,
but OpenMeld Service must not launch, cold-start, authenticate, or perform a
native-interface probe for an unregistered or disabled controller. Enabling a
controller or running setup may perform the fresh probe needed to establish its
current capability evidence. Disabling a controller immediately removes it from
local routing and future live probes; a catalog refresh may update passive
install evidence but must not start a disabled controller.

Cloud-bound ACI reporting is a minimized projection of the richer local
snapshot. It must not send a local command path, launch argument prefix,
authentication type, controller-provided skill inventory, or free-text local
diagnostic message. It may send the optional provider email or bounded account
label only for the authenticated owner's local-runtime inventory so that the
owner can distinguish which account OpenMeld will use. Core receives only the
bounded controller identity, enabled/readiness status, static native
capabilities, native interface, version evidence, bounded check status and
last-success timestamp, optional owner-facing account identifier, and other
fields explicitly required by a current owner-facing product surface. This
account evidence must not enter Organization computer directories, Center Agent
context, Agent Activity, or another member's Computer view. Local CLI and
Desktop diagnostics may retain the richer local snapshot without turning every
local field into the cloud contract.

ACI is local evidence, not final Wake readiness authority. However, when ACI
proves that a selected or enabled local controller cannot execute because its
provider account is not signed in, OpenMeld Service must fail closed in Runtime Agent
Controller reporting. It must submit non-ready report evidence with stable
provider-account reason codes instead of reporting `ready` and waiting for the
actual Wake to fail later.

An incomplete ACI check must also fail closed for current Wake eligibility with
the stable `controller.interface.check_failed` reason code. That safety result
does not prove broken setup: local-agent catalogs and clients must present it as
a retryable check failure, not as `Needs setup`. The next periodic pass should
receive an accelerated one-shot retry even when a previous successful snapshot
exists.

## Runtime Reporting Health

Runtime Agent Controller reports and provider conversation proofs are separate
reporting channels. OpenMeld Service records each channel's last success,
consecutive failures, and latest bounded failure evidence in the shared
`openmeld-runtime-reporting-health-v1` local diagnostic shape. One channel's
failure must not be hidden by the other channel's success.

This local health record is observability for the carrier. It is not service
liveness, Core's local-runtimes projection, Agent Profile readiness, or Wake
execution truth. A stale or failed report may explain why cloud-visible local
agent data is old; it must not independently mark a profile unavailable or
overwrite the last owner projection.

When a reporting request proves the local authentication attached to the
carrier is rejected, the running service may request one debounced reconnect so
the normal handshake can refresh authentication. That recovery must preserve
the per-channel failure evidence, reject stale-socket recovery requests, and
remain separate from read-only status and doctor commands.

## Agent Activity Session Inventory Carrier

The local Service performs a periodic full reconciliation for every explicitly
connected local Project folder and each supported provider. Event hooks remain
the low-latency presence path, but they cannot substitute for complete Session
discovery. The scanner cannot restrict first startup to recent files, cap a
provider at a fixed file count, or treat one bounded page as the entire
inventory.

Each local connection is represented outside the machine only by a one-way
hash of its stable local binding generation. Absolute roots never enter the
request. Before upload, the Service resolves every provider Session working
directory to exactly one current binding and discards unmatched candidates.
Ambiguous matches fail closed and produce bounded coverage failure evidence.

One source reconciliation uses stable native-id order and at most the shared
page limit. The Service persists the last successfully reported source set so a
removed binding can emit a disconnected terminal reconciliation after an
offline interval. It retries one page idempotently and starts a fresh
reconciliation after incompatible local source changes. Core alone stages and
publishes the result.

An explicit CLI Project unbind or archive requests an immediate reconciliation
through the authenticated local Service control plane after removing the local
binding. The command remains locally usable while the Service is offline; the
persisted source set then carries the disconnected fact on the next successful
Service reconciliation instead of claiming that a cloud update already
succeeded.

Provider adapters return the shared native title, lifecycle status, origin,
and Resume/Fork capability facts. A scanner must not read transcript content to
invent a title, infer Working from modification time alone, or report a
capability that the concrete installed provider and OpenMeld adapter cannot
invoke. Installed-but-not-launchable is an error that preserves the last
complete inventory; only a genuinely absent provider is unsupported. OpenCode
resolves its retained database from `XDG_DATA_HOME` when configured and uses
the platform home fallback only when it is absent. Session Inventory transport
remains independent from dispatch,
RuntimeCoordinator, Agent Profile readiness, and Wake reporting.

## Agent Controller Task Lifecycle Callbacks

The Local OpenMeld Service is the delivery carrier for exact Agent Controller
task lifecycle callbacks. OpenMeld-managed Codex and Claude Code hooks write
provider task registrations, completions, and actionable attention callbacks
through the Agent Activity hook dispatcher only after that dispatcher resolves
an exact lane-local Project and Organization binding.

Hook payloads are minimized before durable storage. The local callback record
contains the exact provider task id, Agent Controller ref, Organization id,
stable source, lifecycle type, timestamp, and bounded attention code. It must
not retain or upload prompt text, notification text, transcript paths, command
paths, or an arbitrary provider payload.

The callback is written to a dedicated lane-local durable outbox before any
optional Agent Activity enrichment. The ordinary five-second reporting loop
registers the current Runtime, submits a bounded batch, removes accepted or
reused events, retries transient and registration-order failures with bounded
backoff, and records permanent rejection as a bounded local diagnostic. This
path is event-driven from the controller to local durable state; it does not
poll a model or hold an Agent turn open.

On Service startup, a lane that already has Project bindings refreshes the
exact OpenMeld-owned managed Hook artifacts so new lifecycle support does not
require rebinding every Project. A lane without Project bindings does not
install global hooks. The installer may replace only a recognized OpenMeld-
owned artifact; modified or externally owned configuration fails closed and
remains untouched.

The Service carries evidence but does not decide task completion or
continuation. Core validates Runtime and Organization authority and owns the
subscription observation. Agent Activity, provider process presence, and Agent
Controller availability are separate evidence and cannot settle a task.

## Local Agent Interaction Carrier

The Service owns one in-memory pending-interaction registry for its process
lifetime. The service runner creates it once and injects the same instance into
every socket session, frame router, dispatch queue, and runtime invocation.
These boundaries must require the registry; they must not create fallback
instances that can register a request in one map and route its response through
another.

For one accepted dispatch, the Service serializes provider interaction
callbacks, registers the exact request and authority before sending
`daemon.dispatch.interaction_request`, and waits without ending the provider
turn. On `daemon.dispatch.interaction_response`, it validates the exact
execution authority, resolves the registered callback, and sends
`daemon.dispatch.interaction_delivered`. Unanswered requests are replayed after
heartbeat registration or socket reconnect in request order. Responded requests
resume locally before acknowledgement; if acknowledgement temporarily lacks a
current lease, the Service reports that delivery is deferred rather than
inventing completion.

Task cleanup, Stop, expiry, provider abort, and process exit reject local
waiters with explicit context. The registry is reconnect recovery, not durable
process-restart recovery and not execution truth. RuntimeCoordinator remains
the pending-state owner and decides the visible failure when the local process
cannot continue.

A Computer file access capability decision uses this carrier before the
provider turn starts. It targets the Computer owner even when another
Organization member initiated the Wake. Other members receive no path,
controller capability, or decision details and cannot answer it. This is a
single exact-execution decision, not a new permission store or a second
interaction authority.

Each POSIX Agent Controller invocation starts in its own operating-system
process group while retaining its supervised stdio pipes. The in-flight control
registry records whether Stop targets that process group or one direct process;
macOS and Linux assign one opaque supervision identity before the controller
starts, and controller descendants inherit that identity. Stop snapshots the
controller's current descendant tree, signals the whole recorded group, and
also signals supervised descendants that created their own process groups,
while Windows keeps the direct-process path. The adapter retains discovered
process IDs through graceful-to-force escalation and uses the supervision
identity after process exit, so reparenting cannot hide unfinished provider
work. Descendant discovery is auxiliary to signaling the known process group
and already recorded descendants: a discovery failure must emit a structured
diagnostic after those signal attempts and must never crash the OpenMeld
Service or suppress the primary Stop. A wrapper or controller exit therefore
cannot silently orphan a detached supervised descendant or keep a local
execution slot occupied after an accepted Stop.

A long-lived or multi-thread Agent Controller whose request protocol carries an
explicit workspace starts its host process in an OS runtime directory, not in
the provider workspace. The exact dispatch workspace remains authoritative on
every provider thread and turn request. This separation prevents controller
bootstrap from depending on macOS privacy-protected workspace path resolution
and avoids turning a host-process detail into a second source of workspace
truth. Ordinary one-shot controller commands that do not carry a request-level
workspace continue to start in the provider workspace.

## Local Setup Driver Boundary

Discovering and connecting local agents is a local-machine decision: the only
place that knows which AI tools are installed on a computer is that computer.
Therefore the local setup driver automatically connects newly detected runnable
controllers and runs to completion on that surface. The ordinary setup flow has
no local-agent selector and must not bounce the user out to OpenMeld Web to make
that decision.

- OpenMeld Web does not drive local-agent discovery or registration. Web lacks
  the local-machine facts those operations require; routing a fundamentally
  local operation through a remote surface is accidental complexity. Web's role
  for local setup is to point the user at the local driver and to observe the
  resulting readiness facts (a Space "connect this computer" affordance is a
  pointer to the local driver, not an inline selection step).
- This mirrors the server-fact / local-fact division: Web drives server-side
  facts (Space membership — Web has them), the local driver drives
  local-machine facts (which agents are present, their local registration, this
  computer's connection — Web does not have them). For any surface, the test is:
  does this action need server information or local-machine information? The
  surface that holds the information owns the action.
- The current bootstrap that hands a web token to the CLI
  (`openmeld setup --start-session <token>`) initiates and authenticates a local
  setup. The command carries a browser-approved Device Authorization code that
  the CLI exchanges for a new, independently revocable Computer session for the
  same OpenMeld user. The CLI must validate Prepare ownership before changing
  the active local session. A failed or cancelled handoff restores the previous
  session and Service account alignment. That pending session transition is
  durable: after Terminal exits, process failure, or machine restart, the next
  CLI or Service auth read restores the previous session before proceeding; a
  first connection clears its incomplete candidate. A committed transition is
  never recovered backward. A cross-account switch requires explicit
  interactive confirmation bound to the stable identity of the exact committed
  session the user reviewed. The transition lock compares that identity before
  accepting the candidate; if it changed, setup requires fresh review. Before
  commit, ordinary CLI processes keep using the previous committed session and
  only the transition owner plus its candidate OpenMeld Service may read the
  candidate. OpenMeld Service uses the committed Computer session when it starts
  at login. The handoff must not be used to add an
  agent-selection step to Web.
  A missing or unreadable old bearer token does not veto a freshly authorized
  handoff when the committed account metadata is intact. Metadata is used only
  for account-switch consent and the locked identity comparison, never to
  authorize execution. Rollback preserves the original payload, but does not
  restart a Service with an unreadable credential. Recovery must not reread an
  already revoked candidate token merely to finish local cleanup.
  If the committed account cannot be identified, setup remains blocked with
  an explicit local sign-out action. Explicit logout preserves malformed
  session JSON in a uniquely named file in the same auth directory before
  removing it from the active session path; it does not guess Keychain items
  from damaged metadata or clear unrelated application data.
  A candidate Service may run from its prepared stable carrier before the OS
  service definition is committed. Setup repair and rollback must still drain
  and stop that process; an absent definition means there is no autostart state
  to toggle yet, not that the candidate cannot be reconciled.
  Keeping the legacy Web selector retired is a setup-flow
  consolidation owned by this document; it has no ordering dependency on the
  onboarding planner (`developing/product/onboarding.md`), which treats
  "connect this computer" as one atomic decision and never models setup
  internals.

Setup connects its existing Terminal transport before exchanging computer
authorization and asking for account-switch consent. Canceling the switch or
failing authorization reports a blocked `connect_terminal` outcome through that
same connection and waits for the Core snapshot before closing. It does not
start a local account transition. Normal setup reuses the connection; connection
epochs still reject an outcome from a replaced Terminal. Web removes an unusable
command and offers an explicit fresh attempt. Device authorization stays
single-use, and an unused candidate session is still revoked on cancellation.

Web may offer an enable/disable control for an already reported local Agent
Controller only as a current-service command. That command must target the
current connected device/runtime lane through Core and RuntimeTransportHub,
then be executed by the live Local OpenMeld Service against the local registry
single writer. Web must not write `controllers[].enabled`, synthesize local
registry state, create new local Agent Controller registrations, or report
success when the service is offline, old, unsupported, or not the current
runtime lane.

Web may also let the authenticated Computer owner list verified installations
for an already registered built-in controller and explicitly select one. This
uses the same current-device authorization and RuntimeTransportHub path. The
local registry remains the single writer for the selected launch contract;
paths stay in the immediate owner-only response and must not enter an
Organization projection. Setup remains non-blocking: it preserves a valid saved
choice, otherwise selects the first verified PATH-ordered candidate. Listing or
selection failure stays visible and must not be reported as a successful local
agent refresh.

Installation selection is an idle-only local maintenance operation. The local
execution-slot owner reports whether matching adapter work is queued or active,
and the Service rejects a selection while either exists. Once admitted, the
operation reserves that adapter until the registry write finishes; a Wake that
arrives during this short window remains queued and starts against the completed
launch contract. Listing remains available and returns the current selection
status. Web and other cloud callers may expose selection only when the Service
advertises `localAgentControl.manageInstallationsSafely`; the older
`manageInstallations` capability alone is not authorization for the safe
workflow.

An explicit Off decision is sticky. Setup, service restart, catalog refresh,
binary update, controller reinstall, and later controller detection must not
turn that controller back on. Only an explicit current-service enable command
or an explicit CLI agent enable command may reverse it.

## Current-Device Project Operations

Project controls expose an additive `readConnections` capability. A
`discover_projects` request with `includeCandidates: false` reads the
existing owner/device/lane-local connection store and checks path availability
without Git or inventory discovery. Its `gitStatus: not_checked` and
`not_connected` project status describe an unsearched Project, not a failed
search. This read does not rotate candidate-discovery epochs. Saved local
connections remain the sole durable path authority; this optimization does
not relax execution-time validation or Core-owned Wakeability.
RuntimeTransportHub strips `includeCandidates` for a Service without this
capability. Public local-runtimes responses remain unchanged so existing strict
client readers can continue to use the new Core.

Project discovery and folder connection are local-machine decisions because
only the current computer can inspect and validate its filesystem. Web may
initiate these actions only through RuntimeTransportHub's authenticated,
current-device request-response path. Add Project control as a sibling
capability rather than disguising it as Agent Controller control:

```text
localProjectControl:
  discoverProjects
  connectCandidate
  connectDeclaredPath
  moveConnection
```

`discoverProjects` checks the canonical Projects supplied by Core in one
bounded operation. The daemon may inspect configured roots, Git repository
identity, clones, and worktrees, but it does not create cloud Project truth.
`connectCandidate` accepts only a candidate from the current discovery epoch.
`connectDeclaredPath` validates a user-entered absolute path. Both connection
operations write through the lane-local Project connection single writer and
enforce canonical-path uniqueness across Project scopes.

During rollout, the Core-to-Web `moveConnection` projection is optional.
Consumers treat an absent value as unsupported, so Web may deploy before Core
starts projecting the capability and Core may deploy before every Service
advertises it.

When a connect operation finds an existing connection, the Service reports the
conflicting Project slug, same- or cross-Organization scope, move impact, and
an opaque confirmation token. `moveConnection` is the capability for retrying
the connect with that user-confirmed token. The single writer validates the
token against the current source connection group, then atomically removes the
old connection, restores the old group's default invariant when needed, and
creates the new connection. A stale or mismatched token fails closed; neither
Core nor Web may synthesize or bypass this confirmation. The token is also
bound to the requested Organization, Project, and canonical path, so it cannot
authorize a different destination from the one the user confirmed.

These operations use the same owner account, device, lane, live-session,
request ID, bounded waiter, timeout, and explicit failure discipline as other
current-device operations. A request must fail closed when the intended
current Service is offline, stale, incompatible, or identity-mismatched. Web
must not synthesize local connection state or report success from a cloud write.

Multiple live-looking transport sessions for one owner, device, and lane are
replacement history, not a capability union. Runtime Transport's canonical
freshness order selects exactly one current session, and both the
`listLocalRuntimes` capability projection and RuntimeTransportHub command
routing use that same selection. If that current session omits or cannot serve
a current-device capability, the operation is unsupported or fails closed even
when an older session advertised it. This rule applies equally to Local Folder
Picker, Computer file access, Project control, and Agent Controller control.

Web derives current Project-operation eligibility from the current local-runtime
target and its `localProjectControl` capabilities. Space reply-readiness is a
different product contract and must not gate Project discovery. If the
Project-control request itself fails, its authoritative error distinguishes
Service offline, Service update required, and a retryable discovery failure;
clients must not collapse every failure into Service unavailable.

PeopleComputers Project discovery instead names the selected device and lane.
Its eligibility comes from that exact session's shared `localProjectControl`
control projection, not Binding preference, Agent reports, or Wakeability.
Core reuses the Project authorization and canonical-reference preparation path;
only target resolution changes. An unknown inventory or failed query remains a
retryable checking failure, not evidence that the selected Service disconnected.
Legacy current-target Project operations remain available to existing clients.

An operation response may contain an absolute local path only for immediate
forwarding through Core and Gateway to the authenticated owner who initiated
that request. Immediate forwarding is not storage. Local paths must never be
written to D1, Agent Activity events or projections, cloud snapshots,
Organization-shared Project records, or Center Agent context. Logs, traces,
failure receipts, and diagnostics that cross the local trust boundary use
Project ID, device ID, candidate ID, and binding generation instead of the
path.

The local binding store and Route Registry remain separate. Local Project
Connections map one Project to one or more repository roots inside one lane.
Route Registry maps a repository path to one lane root for global hook
disambiguation. It must not become a second Project binding truth.

The Service has one effective working-folder resolver for local route planning,
Wake launch, local Agent checks, and provider-conversation proof. A Profile's
Default Project connection takes precedence over its fallback Profile workspace.
The resolver produces a path-private current fact with the observation time,
source, Default Project ID, local Project binding generation when applicable,
and one precise missing or invalid reason. Route refresh treats a changed
Binding configuration, Default Project, local binding generation, or effective
folder fingerprint as a new fact. The route cache may preserve routing metadata
for offline startup, but it never restores a cached working-folder observation
as current; the new Service session must observe and report it again.
Dispatch admission compares the route's observed source, Default Project and
local binding generation when applicable, and effective directory with the
current durable local configuration. Once a connection or Profile workspace
mutation is durable, an older route cannot launch new work; catalog refresh
only controls how quickly the new route becomes available again.
Every durable local Project connection writer emits the same lane-local catalog
refresh signal, while an idempotent no-op emits nothing.

Current working-folder facts are a negotiated transport capability. The Service
requests expected routes in `v4`, then falls back through `v3`, `v2`, and the
legacy query only when Core explicitly returns `invalid_payload`. A network,
server, or malformed-success failure preserves the current catalog and never
pretends to be an older compatible Core. Only a successful `v4` read authorizes
the strict `v4` route report; every older response produces the unchanged
legacy report shape and uses the transitional per-Profile resolver so Default
Project behavior remains correct. While a `v4` session is live, the normal
catalog cadence refreshes unchanged observations before their freshness window
expires. A changed local Project binding generation or effective working folder
still forces an immediate new report. Restart begins with legacy/unknown cached
evidence, then automatically re-observes and reports the new session's current
facts without asking the person to reconnect or rebuild the Profile.

## Local Folder Picker

Local Folder Picker is an owner-self Computer interaction capability.
It lets an authenticated Web action ask the exact live OpenMeld Service to open
the operating system's folder chooser on that computer. It is a sibling of
`computerFileAccess`, `localProjectControl`, and `localAgentControl`; none of
those product contracts owns it.

PeopleComputers folder selection names the exact device and environment and
revalidates the current owner Service session; it never falls back to the
account's routing preference. The existing current-Computer endpoint remains
for supported clients. A browser draft discards late picker results after
either the selected device or environment changes, or the editor unmounts.

The picker returns only folders the person selected. It does not inspect folder
contents, discover Projects, validate repositories, update Computer file access,
connect a Project, or save an Agent Profile working folder. Each product surface
puts the returned path into its own draft and keeps its existing explicit save
or connect action. The owning business contract remains the only writer.

The Service invokes one small operating-system picker adapter only after an
explicit picker request. The adapter has no persistent UI, background polling,
Dock or taskbar presence, or local business store. It exits after selection,
cancellation, failure, or the picker-specific bounded timeout. Only one picker
may be open for one Service at a time; a second request returns
`local.folder_picker.picker_busy`. Picker requests use a human interaction
timeout, not the shorter default current-device operation timeout. The helper
timeout must finish before the Runtime Transport operation timeout, and Service
shutdown must terminate and await an active helper before the carrier exits.

Platform adapters must use the current interactive desktop session:

- macOS uses the system `osascript` folder chooser in the signed-in GUI session;
- Windows uses the system PowerShell and Windows Forms folder chooser when the
  Service process is already in the signed-in user's interactive session. A
  Windows system Service running in Session 0 returns
  `no_interactive_session`; it must not try to display UI across the session
  boundary. Shipping a Windows system-Service distribution therefore also
  requires a separately reviewed per-user interaction bridge; and
- Linux uses `zenity` or `kdialog` in a signed-in graphical session. When no
  supported graphical provider is present, the Service omits the capability and
  Web keeps Project discovery and manual path entry.

These adapters define source-level behavior for all three desktop operating
systems. Actual production availability still follows the supported OpenMeld
CLI/Service release targets; the folder-picker contract does not imply that an
installer exists for an otherwise unreleased platform.

Selection and cancellation are different outcomes. Cancellation is an ordinary
no-change result and must not produce an error toast. Missing helper artifacts,
no interactive session, unsupported platforms, portal failures, timeouts, and
identity mismatches use stable `local.folder_picker.*` codes with path-free
messages chosen by the Service; arbitrary helper stderr or messages never cross
that boundary. The manual path control remains available when native selection
is unavailable.

Selected paths may cross Web, Gateway, Core, RuntimeTransportHub, and Service
only in the authenticated owner's immediate request-response. They must never
enter command arguments, D1, browser persistence, logs, traces, failure
receipts, diagnostics, Agent Activity, Organization state, or Center Agent
context. Scripts are supplied through stdin where the platform requires them,
and the adapter returns its typed result through supervised stdout. Selected
paths never appear in process arguments or stderr. The Service validates the
result and selected directories before returning it.

The capability is optional and independently negotiated. Older Services omit
`localFolderPicker`; clients keep existing Project discovery and manual path
entry without prompts or warnings. A Service advertises the capability only
when a supported local picker adapter is available. Temporary absence of an
interactive session is an operation result, not a reconnect-time capability
rewrite.

## Service Health And Wakeability

Service health is not Wakeability.

A service can be installed, running, or able to report local inventory while the
Agent Profile still cannot reply in the current Space. Local service evidence is
one input to the product reply path, not the final answer.

Final user-facing Wakeability belongs to the transport Wakeability contract. Agent
Profile surfaces, Web setup, CLI guidance, and Space membership displays must
not recompute Wakeability from service health alone. The Service reports current
local facts and freshness; it does not consume a Wake Outcome or infer a lasting
blocker from an earlier failure.

OS service manager job-state evidence (for launchd: `launchctl print` runs,
state, last exit code, and pended-spawn markers) is startup failure diagnostic
evidence only. After a startup wait fails it may drive failure cards, the
lifecycle journal, and Agent View diagnostics — for example distinguishing a
job macOS never spawned (Login Items blocked) from a crash loop with a nonzero
exit code. It must never feed service health, Wakeability, readiness, or
lifecycle decisions. A service-manager `running` state corroborates lifecycle
success only when the same full inventory also proves the exact active bundle,
install state, runtime contract, live managed background runtime lease, and no
blocking ownership anomaly. Gateway connection and controller catalog loading
may converge later and do not gate that local lifecycle result.

## RuntimeTransportHub Fast Paths

RuntimeTransportHub owns the live daemon WebSocket/session and route lookup
surface. The daemon stream, reconnect admission, owner-service lookup,
single-route lookup, and batch-route lookup are transport/readiness fast paths.
They may reap local expired leases because that is part of route lookup
semantics, but they must not synchronously run RuntimeCoordinator or other
background housekeeping scans.

When a fast-path read reaps an expired route or service-liveness lease, Runtime
Transport may publish targeted `agent.readiness.invalidated` refresh signals for
the affected Agent Profile IDs. That publish is allowed only as bounded
housekeeping caused by the lease transition the read already observed. It must
not become a general read-path writer, broad invalidation sweep, route
registration authority, or Wake execution decision. If a future implementation
needs larger scans, it belongs in bounded alarm housekeeping instead of the
request path.

The local service daemon stream URL remains on Gateway. Gateway is the public
authenticated endpoint for `/v1/daemon/stream`; it forwards the canonical OpenMeld
request context to Core and returns Core's WebSocket upgrade response without
accepting a local Gateway socket or running a long-lived frame relay. The live
daemon session after upgrade belongs to Core's RuntimeTransportHub transport
state.

RuntimeCoordinator remains the in-flight Wake execution authority, and its
background alarms may be scheduled by mutation paths or the alarm itself. There
is no separate RuntimeCoordinator Durable Object today; RuntimeCoordinator alarm
orchestration runs as in-process application processors inside
RuntimeTransportHub, while the authority writers remain in the hub. Those
background scans must not block the user-visible facts that decide whether the
service can reconnect or whether Core can answer current Wake route readiness.
RuntimeTransportHub background housekeeping must therefore run as bounded,
resumable alarm work. A single alarm invocation must not drain an unbounded
RuntimeCoordinator backlog, and any phase failure or exhausted alarm budget must
schedule a near-term continuation instead of relying only on platform alarm
retries.

## Wake Route Registration

Wake route registration is the Core-owned fact that says whether an Agent
Profile is currently registered on a connected local OpenMeld Service for Wake.

OpenMeld Service reports local Wake route evidence through `LocalWakeRouteReport`.
That report contains the local route catalog the service can currently carry
and the profiles it deliberately skipped, with diagnostic reasons. The report is
local evidence only. It does not make an Agent Profile's Wakeability `Available`,
reserve execution, or decide the final Wake outcome.

When every route came from negotiated expected-routes `v3`, the Service also
advertises `profileConfigurationRevision: true` and reports each route's
`bindingId` and `configurationRevision`. Runtime Transport compares that applied
identity with the identity frozen for the accepted dispatch. A mismatch returns
`daemon.profile.configuration_not_synced` before local execution starts. When
the mismatch is ordinary propagation (an older revision for the same Binding
id), Runtime Transport first holds delivery inside a bounded convergence window
and nudges the Service to re-sync its route catalog, so an immediate Wake after
an acknowledged settings write does not require a manual second Wake. An expired
or non-propagating mismatch still fails closed with the same reason code. The
Service omits the capability and revision report when it had to use an older
expected-routes contract, so an old Core/Service pairing keeps the prior
behavior instead of failing during a rolling upgrade.

Core and RuntimeTransportHub own the readable `AgentWakeRouteRegistration`
projection. The projection uses explicit states:

- `registered`: the profile has a live reported Wake route.
- `pending`: Core is still waiting for a local service report.
- `skipped`: the service saw the profile and deliberately did not register it.
- `rejected`: Core rejected the reported route registration.
- `expired`: the reported route evidence is no longer fresh enough.
- `unavailable`: no usable registration evidence exists.

Web, CLI, Space membership, and owner diagnostics must consume that projection
instead of inferring Wake-route state from service health, Binding existence,
route lookup cache misses, or viewer-local reply eligibility.

Route registration is still not final product readiness. The complete product
question remains:

```text
Can this Agent Profile reply in this Space through the intended Wake path now?
```

`AgentWakeRouteRegistration` answers only the local route part of that question.
The compatibility `AgentWakeAvailability` and `AgentExecutionReadiness`
implementations combine it with Binding, transport, compatibility, and policy
evidence into the user-facing Wakeability verdict.

### Route Catalog Derivation

The local route catalog answers "which routes is this service expected to
carry now". Its cloud half is the Core-owned expected-routes projection (see
Expected Routes Projection in
`developing/architecture/agent-transport-contract.md`). Its local half stays
local: controller enablement, launch contract, transport and streaming mode,
context-id mapping, and workspace state come from the local registry and
config. The service joins the two into the route catalog and its skip reasons;
it must not rebuild the device-scoped Binding answer from per-profile reads.

Catalog consumption rules:

- Built-in controller discovery runs in the existing controller inventory report
  pass, independently of route catalog refresh. A discovered registration uses
  the normal lane-local catalog-change signal. Install detection for an unrelated
  controller must not gate registration for an already configured controller.
- An explicit catalog-change signal starts the existing single-flight catalog
  refresh independently of an in-flight heartbeat. New route registration
  must not wait for old-lease renewal or its local maintenance inspection.
  Changes arriving during a catalog refresh remain pending until that refresh
  finishes; heartbeat completion must not consume that pending work.
- The projection response is operation-scoped evidence. It is never persisted,
  and the route catalog cache remains a failure fallback only.
- Carrier startup and periodic catalog refresh only check existing local
  projection and workspace state. Setup and explicit repair own mutations;
  catalog reads must not run repair work or block healthy routes behind it.
- After a successful catalog refresh, the Service reconciles a changed Agent
  Controller Permission Mode into matching in-flight tasks. It may mark the new
  mode on a task only after the active adapter explicitly reports `applied` for
  later tool requests. Missing adapter capability, a launch-only mode, an
  inactive-task race, and repair-only constraints are explicit `not_applied`
  diagnostic outcomes: they do not fail route registration, roll back the saved
  Binding, or pretend the active controller changed. A pending Agent
  Interaction remains separate and still requires its own response.
- One catalog load has one bounded total deadline. A phase that does not settle
  must fail with its phase name and measured duration so startup can recover
  from the last accepted cache, or start empty and retry when no cache exists.
  It must never leave route registration permanently pending.
- One catalog load resolves its account context once and reuses it for every
  Profile workspace inspection. It must not fan out identical Keychain reads
  per Profile.
- One OpenMeld Service process reloads the unchanged local auth session from
  secure storage once and reuses it while the persisted session payload is
  unchanged. Clearing, replacing, or editing that payload invalidates the
  in-process copy; a new Service process reloads it from secure storage. Remote
  authorization checks still decide whether the bearer session is valid.
- The managed CLI and its Service carrier own that local auth session. Future
  local clients reuse its status and actions through the Service contract; they
  do not read the bearer token through a shared Keychain access group or create
  a parallel local sign-in state.
- On macOS, the packaged CLI uses Security.framework with the user's normal
  Keychain. Each operation runs in a short-lived child process with a
  five-second deadline. Before reading a request, the child verifies through
  macOS Code Signing Services that its parent is the same OpenMeld executable;
  direct invocation from another local process fails before Keychain access.
  Every operation disables Keychain user interaction
  inside that child and must return an explicit authentication failure instead
  of opening a macOS authorization window. Normal setup and login writes remain
  silent; if macOS requires interaction, setup uses the documented private-file
  fallback. If Security.framework never returns, the parent terminates that
  child, caches the timeout, and does not query Keychain again during the same
  CLI or Service process. A command authentication check may re-evaluate the
  CLI-owned session once after `session_token_unavailable`; the cached timeout
  makes that re-evaluation fail immediately without another Keychain query,
  while another one-off helper failure may recover through the single bounded
  retry. A persistent unavailable result remains distinct from an invalid,
  expired, or revoked session and keeps its reason in Agent View. Setup may
  then keep the current
  session in a mode-`0600` file inside a mode-`0700` OpenMeld directory and must
  expose the downgrade as a warning. Access tokens are sent to the helper over
  stdin, never argv. The Service may consume that same CLI-owned session; it
  must not create a second authentication owner. A new process may try
  Keychain again. A later login may replace the fallback with a Keychain item;
  there is no automatic private-file-to-Keychain migration. If deleting a
  replaced credential fails, the CLI retains its storage reference as pending
  cleanup outside the active session and retries it during a later explicit
  login or logout instead of silently forgetting it.
- An npm-distributed CLI or unattended developer tool that cannot embed the
  native helper must not invoke `/usr/bin/security` as an alternate token path.
  A new npm CLI login uses the documented warned mode-`0600` private-file
  fallback. An existing Keychain reference returns an explicit setup-or-login
  recovery error. Developer HTTP tools use an isolated lane with private local
  token storage or route through the packaged CLI. These paths must fail closed
  instead of queuing interactive authorization windows. Logout removes an
  unreadable active session so it cannot block a new login. An npm login may
  replace that session with the private-file fallback while retaining the old
  Keychain reference for later cleanup by a capable packaged CLI.
- A background Service must not preflight a custom workspace with the POSIX
  `access` syscall. On macOS, a LaunchAgent can block indefinitely while that
  syscall crosses a protected-folder privacy boundary. Catalog inspection uses
  directory metadata and permission bits; the actual controller launch remains
  the authority for an operation-time access failure and must report that
  failure explicitly.
- A failed projection read keeps the current catalog. The catalog must not
  shrink from an unresolved state — the same invariant that protects daemon
  boot when the route catalog cannot be loaded.
- Server-side exclusions map onto existing local skip reasons (for example
  `profile.inactive` maps to `profile.status.inactive`). A route bound to
  another runtime is simply not a local route; it produces no local skip
  diagnostic.
- A device-level `missing` or `conflict` runtime resolution maps to the
  existing service-level reasons (service not registered or not running),
  never to invented per-profile skips.
- A pre-projection server (404) falls back to the per-profile read path. The
  fallback is transitional compatibility only and is expected to be removed
  once released CLI and server versions both carry the projection.
- Expected-routes negotiation is newest-first: `v3`, `v2`, then unversioned,
  and only an explicit `invalid_payload` response advances to the older shape.
- Route cache schema `v4` retains the optional Binding id, revision, and runtime
  id. Older cache schemas remain readable, but they cannot advertise revision
  consistency until a fresh `v3` catalog succeeds.

### Local Image Attachment Materialization

Claude Code, Codex, and OpenCode currently report
`imageInputCapability: local_file_path`. OpenCode uses this static declaration
until the model catalog exposes a stable per-model vision capability.

For a Wake source snapshot with image attachments, the local service downloads
each attachment through the existing authenticated Space attachment route. It
validates attachment and task identifiers as safe path segments, verifies the
response MIME type and byte count, and writes the image under the selected
provider runtime workspace:

```text
.openmeld/attachments/<taskId>/<attachmentId>.<extension>
```

The Agent Controller prompt receives the absolute local paths and the original
Space file names when present. One failed or expired attachment does not fail
the Wake: the prompt identifies the unavailable image count, and the service
records one structured `daemon.run.attachment_download_failed` event per
failure with the dispatch, task, Space, profile, attachment, and error context.
No credential or attachment URL is written to disk.

Attachment directories follow the provider runtime workspace lifecycle. The
service does not introduce a separate attachment cleanup path or claim a
shorter retention period than the workspace that contains them.

### Canonical Space File References

New Space chat uploads use canonical Space File references rather than the
legacy image-attachment materialization path. The dispatch source snapshot
carries only server-resolved `fileId`, sent `revision`, name, MIME type, and
size. The local service preserves those references in the Agent Controller
prompt and prints exact `openmeld space files read` and `download` commands for
the acting Agent Profile. It does not eagerly copy every file into the provider
workspace, mount the Space Durable Object, or turn the local workspace into a
second file authority.

For output, `openmeld space action reply --file <path>` uploads each local path
through the ordinary authenticated Space File API before recording the final
dispatch action. The action carries only canonical file references. Any local
validation or upload failure aborts the reply; it never publishes a message
that silently omits a requested file.

## Service Runtime Records And Hibernation

Runtime Transport persists one ServiceRuntime record per (account, device) in Durable
Object storage. Register and every heartbeat overwrite the record; cold starts
restore sessions and leases from it. The record is the durable carrier of
session identity, capability declarations, lease state, last heartbeat
timestamp, and known delivery disconnect timestamp.

Hibernated sockets are adopted on wake, never closed because in-memory state is
missing. An unknown session self-heals through the client's next heartbeat and
register on the same socket. Socket attachments carry identity pointers only;
they are not a state recovery mechanism, and state payloads must never be
serialized into them.
Daemon error frames do not currently carry a request correlation ID. The client
may reject a pending waiter only when the error uniquely identifies that request
class, such as an explicit invalid-register payload. An uncorrelated error from
an optional frame must remain observable without rejecting an unrelated
register or heartbeat waiter; those requests keep their own bounded timeout and
response contract.
If a restored route has no adopted socket, Runtime Transport preserves the known
delivery disconnect timestamp as diagnostic/restoration evidence. For legacy or
live records with no known disconnect timestamp, Runtime Transport may
synthesize the restore moment as the disconnect clock and persist it after
restore/adopt convergence, so repeated cold starts keep one stable diagnostic
timestamp. That timestamp explains delivery interruption and adoption history;
it does not decide service liveness, Wakeability, or a public route
state. The restored record's last heartbeat stays the service-liveness
timestamp.

The client treats startup network failure the same way: when the initial route
catalog cannot be loaded and no cache exists, the service enters the documented
waiting-for-profiles state with an empty catalog and converges through the
periodic catalog sync. A transient network fault must never become a service
exit or a launchd crash loop, and a long-lived process must retry a failed
network request once on a fresh connection before reporting failure.

If the local service process still reaches an uncaught exception or unhandled
rejection, it must fail closed with durable local evidence: write an OpenMeld Service
lifecycle crash event with the error name and message, clear the local runtime
state projection so the supervisor can claim a clean replacement, and exit
non-zero. The daemon must not swallow an unknown process-level crash and keep
running with uncertain socket or runtime state.

Supervisor bootstrap must not trust a `running` local runtime projection by
itself. Before rejecting startup as `service_already_running`, OpenMeld Service must
verify that the recorded pid is alive, that the process still belongs to the
current daemon lane/bundle, and that heartbeat evidence is fresh. If any of
that evidence is stale or mismatched, the bootstrap must write a lifecycle
takeover event with the stale-state reason, clear the stale projection, and
continue startup so launchd/systemd can replace the dead process without human
repair.

The local service question is narrower:

```text
Can this OpenMeld Service be used as part of the intended reply path now?
```

If the answer is no, the surface should explain the user-facing next action and
preserve machine-readable diagnostic evidence for agents and operators.

## Local Machine Recovery

Some failures prevent OpenMeld Service from running even when the Service
installation itself is correct. Examples include a full or unwritable disk,
denied local setup permissions, exhausted process or memory resources, an
operating-system block on background execution, and another active setup
process.

The CLI owns one local-machine recovery boundary for these failures. It adapts
the original operating-system evidence into the shared `LocalMachineIssue`
contract, preserves the original error for diagnostics, and gives Human View
one plain-language next action. Prepare, Desktop, and Web consume that same
issue; they must not independently classify the raw error or invent a different
recovery instruction.

Local command locks use an atomically created directory at the canonical lock
path and one owner-specific metadata entry inside it. Release removes only that
owner entry and then the empty directory; it never renames the canonical lock
path or creates a window in which a second setup can enter while the first lock
is still being checked. New clients read and honor legacy file locks during
rollout but never reclaim them automatically because the file format cannot
prove that the owner did not change between inspection and removal. After the
older process releases its file lock, the next new client publishes the
owner-scoped directory format. An older client that encounters a new directory
lock fails closed until the current setup releases it.

If a legacy lock's owner is provably gone, ordinary lock acquisition reports
that the lock came from an older version instead of claiming its owner is still
running. Setup adapts that result to `local_machine.concurrency.orphaned`.
Every affected command gives the same lane-aware `openmeld repair local-state`
action. The user must close every other OpenMeld command before taking that
action because any older command could still replace a legacy file lock after
inspection. The explicit repair scans every command-lock owner in the current
lane, double-confirms each unchanged stale legacy lock before removing it, and
reports the total repaired; it is the only mixed-version path allowed to remove
a legacy lock. New owner-scoped directory locks remain automatically
recoverable.

Setup may automatically repair Service-owned drift and retry a transient
startup once. Once the CLI confirms a blocker that requires a computer or user
change, setup must stop the immediate repair/start loop and return the issue.
The operating-system supervisor uses a bounded restart delay of at least
60 seconds so a persistent blocker cannot create a tight crash loop.

This recovery boundary owns neither Service liveness nor Wake execution truth.
A current local-machine blocker may make the Service unavailable, but an
already accepted Wake remains owned by RuntimeCoordinator until it receives a
real terminal result or reaches its hard deadline. Recovery UI must therefore
never silently rerun a Wake, publish success, or finalize an execution from
local-machine diagnostics alone.

The Organization member Service-status projection asks this same narrow
question through Runtime Transport's owner-service lookup. For a member,
`connected` means at least one current session is execution-compatible and not
blocked by a required Service update; `needs_attention` means current sessions
exist but none are usable; `not_connected` means the authoritative lookup has
no current session; and `unknown` means the lookup failed. Multiple computers
collapse to `connected` when any one current session is usable. These states
must never be promoted into Agent Profile readiness or Wakeability.

## Service Freshness And Compatibility

Computer-level local-agent availability is an existential capability summary,
not an all-controllers health check. With a current, compatible Service session,
one enabled, ready local controller is sufficient for the computer to offer local
execution. An unrelated controller's failed check or missing sign-in remains
visible on that controller but must not block a ready controller. A partial
catalog remains partial; do not erase its individual failures to make the summary
available. This summary does not authorize a Wake: Core's Agent Profile
Wakeability must still validate the selected controller, Binding, permissions,
and task requirements. It must not overwrite an individual execution's outcome.

Service freshness and execution compatibility are separate diagnostic concepts.
Freshness says whether a newer Service bundle exists. Compatibility says whether
the current Service is still eligible to receive new Wake work.

For setup and local component alignment, OpenMeld Service version, bundle, lane, and
runtime-contract drift should still collapse to one primary user action:

```text
Update OpenMeld Service
```

The primary entrypoint for that action is `openmeld setup`. Lower-level
`openmeld service repair` and `openmeld service update` commands may remain as explicit
diagnostic/service commands, but product surfaces should not ask a user or setup
agent to choose between them.

Setup starts OpenMeld Service as a background service and keeps sign-in autostart
enabled by default, because this computer cannot receive local Wake work while
the service is stopped. Human-facing setup output must state that OpenMeld Service is
running, that it starts automatically when the user signs in, and that
`openmeld service autostart disable` disables sign-in autostart. It must also state
that `openmeld service stop` stops OpenMeld Service and local agents cannot be activated
until OpenMeld Service starts again.

On Windows, native Task Scheduler tasks run with the current user's interactive
token and ordinary privileges. They start at that user's sign-in, run on battery,
do not require network availability, have no total execution deadline, and restart
after process failure. The maintenance task also has an hourly trigger. Task names
include the user's SID and lane; passwords and administrator privileges are not
required for new installs. Logging out ends local availability, as does logging out
of the macOS LaunchAgent session. Locking the screen does not mean logging out.
Task registration is process supervision, not Service readiness: startup still
requires the current Service lease, account/lane alignment, and Core connection.

The Windows adapter retains the serialized `windows-service` controller identifier
for supported local-state and wire readers; that identifier does not imply SCM.
New installations do not register batch files as SCM executables. A legacy SCM
registration is migrated only after it stops and only when its executable matches
this lane's exact legacy script. A different installation or insufficient migration
permissions fails visibly. The replacement task stays disabled until the old
registration is removed, so migration cannot create two execution owners. Task
Scheduler's registered action is the source for command and environment diagnostics;
new installs do not maintain a parallel batch-file configuration.

On macOS, the managed LaunchAgent uses `RunAtLoad=true` and `KeepAlive=true`.
The npm distribution invokes its generated OpenMeld-owned wrapper through
`/bin/sh`. The binary distribution keeps its versioned, signed managed binaries
as the update and rollback sources, but launchd executes an exact copy from one
stable lane-owned physical path. An update or rollback must verify the source
fingerprint, atomically replace that copy, and preserve the same launchd command
path; the stable executable must not be a symlink to a version directory. This
keeps macOS Files and Folders authorization attached to one Service identity
across ordinary version changes. The first update that migrates an older
versioned launchd registration may still require one macOS confirmation. The
user-facing stop path must disable the LaunchAgent before booting it out, so
explicitly stopping OpenMeld Service is respected instead of being immediately
undone by launchd.

The binary and npm distributions use different stable carrier files within the
same lane. The active distribution is the only writer for its carrier and
registration; an npm process must refuse to replace binary-managed state, and a
binary migration must not keep using an npm wrapper as a parallel owner. Every
Service-manager carrier mutation records timestamp, pid, executable, lane,
preset, distribution, operation, and target path in the lifecycle journal so a
later overwrite has one attributable writer.

The npm Service bundle copies and fingerprints only its platform-neutral
JavaScript runtime. CLI-only compiled artifacts, including the macOS secure
storage addon, stay outside that bundle and remain covered by the CLI artifact's
own signed release integrity. Their presence must not make the Service bundle
hash differ between macOS and Linux.

The OS service manager registration is a per-user global resource keyed only by
the env preset. `OPENMELD_HOME` isolates lane files but does not isolate this
registration, so any process that mutates a service registration must fail
closed unless its lane intent is unambiguous: test processes must never mutate
the published production registration, and a process whose effective root left
the published production lane must state an explicit `OPENMELD_ENV_PRESET`
before mutating the production registration. Isolated validation targets the
`dev-local` or `canary` service identity or stubs the service manager.

Service alignment must compare the complete environment target persisted in
that registration: env preset, Gateway URL, Auth URL, and user-facing CLI
command. Matching executable and bundle versions are insufficient. When the
registration is readable but its environment target is incomplete or differs
from the current setup target, alignment fails closed and performs a full
controlled update. Read-only status exposes the observed target as diagnostic
evidence but never repairs it. This prevents a healthy process registered
against one local or production backend from making setup for another backend
report a false success.

The supervisor registration is also the only thing that restarts OpenMeld Service
after a crash or an external kill, so a supervised daemon treats a missing
registration as recoverable drift: it periodically re-observes its own
registration and re-installs the registration files when they disappear, with
bounded retries. The platform service manager owns the repair commit boundary:
it returns success only after a fresh observation confirms that the registration
is installed and enabled. Command or probe failures retain their error context
in warning or journal evidence. When the definition was missing before repair,
installation is fail-atomic: a failed install or verification attempts every
platform cleanup step and rolls back the newly written definition so a later
pass still observes missing drift rather than mistaking a partial repair for an
explicit autostart-disable. If cleanup itself cannot remove the partial
definition, the daemon keeps a service-owned durable repair-pending marker and
continues the same repair on later passes. Because the OS registration is
global per service identity, the repair marker and daemon lifecycle lock use
that same owner's path. Production and canary retain canonical preset-owned
coordination independent of `OPENMELD_HOME` overrides. Development Service and
maintenance identities instead use a stable suffix derived from the absolute
effective `OPENMELD_HOME`, and their coordination remains inside that home.
This completes worktree isolation without a second lane registry or transient
identity variable. Existing development definitions with a mismatched home are
not adopted. Old unsuffixed development registrations require separate,
owner-verified retirement; new lanes do not clean them up automatically.
Registration repair, install, start, stop, uninstall, alignment,
auto-heal, and explicit autostart changes all reuse that one
lock identity. Nested registration work in the same lifecycle command reuses
the held lock; competing commands or roots cannot enter until it is released.
A successfully confirmed explicit autostart command clears the repair marker
before releasing the lock. This prevents a later reconcile pass from undoing
the user's explicit choice. The reconcile pass never boots or starts the job,
because the running daemon already is the job and a second spawn would race it.
Without a repair-pending marker, an installed but disabled registration is
always treated as an explicit autostart-disable. On an observed stop signal, the daemon
journals the signal together with a best-effort snapshot of its supervisor
registration, so an external `bootout`/uninstall that leaves no other lane
evidence is provable from the lifecycle journal afterward; evidence collection
must never block shutdown, and collection failure remains observable.

The Service never auto-stops because the current route catalog is empty. Only
an explicit Stop, logout/reset policy, or an operating-system policy may move
the desired state to stopped. Empty-catalog operation must remain bounded and
low-resource while preserving update, reconnect, and future controller
discovery.

Release policy decides whether that update action is advisory or blocking.
`available` means a newer Service is available and current Wake work can
continue. `required` means the Service must be updated before the affected
capability can receive new Wake work. Independently, Core keeps a monotonic
minimum supported Service version for versions already proven unsafe. That
floor becomes active only when Core's stable-channel release manifest proves
the matching or a newer Service release is installable. A Service below the
active floor receives an effective `required` projection and cannot receive new
Wake work, even when the latest release itself is advisory. This keeps healthy
supported Services eligible without allowing a later optional release to
re-enable a known-broken Service or announcing an unavailable recovery target.

The current monotonic floor is OpenMeld Service `0.3.153`. It is the first
supported baseline that reports current working-folder facts and keeps reply
observation owned by the accepted Wake, in addition to the existing startup
recovery, managed-update, and active Permission/Wake behavior. Once the stable
release manifest activates that floor, Core projects every connected older
Service as `update_required` and blocks new Wake admission without terminating
work already accepted by RuntimeCoordinator. The user-visible `requiredVersion`
is the newer of this compatibility floor and the current installable Service
release, so the action always names a version the user can actually install.
Before the stable release manifest reaches the source floor, Core leaves that
newer floor inactive rather than projecting `requiredVersion` above
`latestVersion`. A later advisory release may raise that remediation target,
but it must not lower or bypass an active compatibility floor. A Service already
at `0.3.153` remains supported and receives only the advisory update policy of a
newer release.

Wake Stop local control is an affected Service capability. A Core/Web deployment
that exposes Wake Stop must use a local-components manifest whose Service bundle
hash matches the carrier that understands the Wake Stop control frame and local
in-flight task registry. New Core talking to an old Service must fail closed with
typed unsupported/retry-later diagnostics; it must not treat delivery failure as
`cancelled`. Real Stop smoke must use an updated dev, canary, or production OpenMeld
Service matching the stamped manifest, not an older already-installed service.

Service version comparison still must never become final Agent Profile
readiness truth. The service can only provide local carrier evidence. Core-owned
Agent execution readiness decides whether the intended Agent Profile can reply.

Core owns the user-visible local component update projection. The projection is
based on the tracked local component release manifest, Core's monotonic minimum
supported Service version, and live OpenMeld Service session evidence, including
the reported service version. Web, Space panels,
Wake execution, CLI diagnostics, and Agent-led setup guidance must read that
projection or the derived Core readiness result instead of each independently
guessing whether a local service is current.

When OpenMeld Service is connected but does not report a service version, Core
cannot prove that it satisfies the minimum supported version. The user-visible
action is `Update OpenMeld Service`, and new Wake work must not be sent to that
service. When the route is temporarily offline but only execution contract
evidence is available, Core may show route-refresh guidance; it must not infer
service package freshness without a concrete live session version.

The shared update action is the Web-generated setup command. On supported macOS
production setup defaults to the managed binary distribution: the bootstrap
downloads and verifies the manifest's gzip transport, decompresses and verifies
the final signed executable, verifies its published Apple Developer ID identity,
runs `install-self`, reconciles a known older
global npm `openmeld` copy to the exact
manifest version when the current terminal still resolves to it, verifies the
ordinary command, and then runs setup through the managed binary path. The
Service remains owned by the managed binary; npm reconciliation only closes the
legacy command-entry gap and must finish before setup can report completion.

After reading the manifest, setup first compares the lane-managed executable's
exact size and sha256 with the published raw executable record. It reuses an
exact match after verifying the declared Apple signing identity, without
downloading or reinstalling the CLI. A missing, truncated,
or same-size-but-different executable follows the verified download and
`install-self` repair path, which also forces Service carrier refresh.

For Windows, explicit `?dist=npm`, or npm recovery, the package-based commands
are:

```text
npm install -g openmeld@latest && openmeld setup
npm install -g openmeld@latest && openmeld setup --view agent
```

Use the first package-based command in human Web surfaces only when npm
distribution is selected. Use the second command only in Agent-led setup prompts
or Agent View diagnostics for npm distribution. Use
`npx -y openmeld@latest setup` only for npm bootstrap or fallback when the
global `openmeld` command is not installed yet.

## Human View And Agent View

Human-facing service output should answer only:

```text
Can OpenMeld Service be used now?
Why not?
What should I do next?
```

Human View must use clear product language and avoid raw anomaly terms,
fingerprints, cleanup plans, lifecycle internals, or other implementation
details.

Agent View keeps machine-readable diagnostic evidence for agents and operators,
including reason codes, anomaly codes, environment targets, compatibility
evidence, and raw diagnostic messages. When a controller rejects a Wake before
prompt execution because model discovery is incomplete, Agent View may include
the bounded requested model, reported current model, model source inventories,
each inventory's reported count and truncation state, source-consistency state,
protocol, and recheck attempt. This local diagnostic projection must validate
its bounded shape before persistence; arbitrary adapter diagnostic objects must
not enter the journal. It must not become model availability truth or cross the
task-result contract as an unversioned field.

Environment mismatch must be clear in Human View as `Wrong OpenMeld Environment`.
Agent View should keep the precise environment evidence. Do not collapse an
environment mismatch into a generic sign-in failure.

Read-only status surfaces must remain read-only. Reporting service state must
not silently repair, reinstall, stop, start, or mutate runtime state.

## Setup And Repair Success

Setup and repair exist to restore local infrastructure for the current intended
account, device, and lane.

Setup succeeds when the service is aligned for this computer, local
controllers/capabilities have been detected and reported as far as the local
machine allows, and OpenMeld-managed local instructions are aligned. Setup does not
prove that an Agent Profile can reply in a specific Space or that a future Wake
will succeed. Those questions belong to Agent Profile Binding, Space
membership, Core readiness, a concrete Wake execution, and trace diagnostics.

The Web Prepare handoff has a deliberately narrower user-visible milestone:
`Computer connected` means terminal authentication was persisted and the local
OpenMeld Service was aligned and connected for the intended account, device,
and lane. It does not wait for or imply Agent Controller readiness. Controller
discovery and per-controller attention continue in the background and update
the Computer projection independently.

Human completion presents that background convergence as local agents syncing;
an empty Web-handoff selection is not evidence that no supported controller is
installed. The concise success summary links back to OpenMeld Web, while
versions, process state, autostart, and stop controls remain on the read-only
Service status surface. The summary says the computer is connected rather than
ready, and it does not infer Setup versus Update from a Computer id because the
same id may represent reconnect. Important completed Human View progress steps
carry a presentation-only local `HH:mm:ss` timestamp and elapsed duration;
active detail and spinner lines do not. Those display times never participate in
execution, waiting, readiness, or Service lifecycle decisions. Agent View keeps
the structured setup and Service evidence. Partial completion continues to
expose its cause and recovery action.

Repair succeeds only for the component it repairs. It must not claim success
just because a process started, local files were rewritten, or inventory was
detected, and it must not project service health as final Wakeability.
The top-level command entry owns interactive authentication. Nested lifecycle
and background-start operations run only after that entry decision and must not
open another authentication prompt. A cancelled start remains `cancelled`; it
must never be normalized into a completed-but-stopped repair or trigger an
automatic retry loop.
Repair first compares the intended bundle, service-manager registration and
its complete environment target, runtime contract, saved desired state, and
effective running state. When those facts are already aligned, repair succeeds
without stopping or rewriting the Service. Only a decision that requires
mutation enters the controlled lifecycle below; an explicit forced repair may
enter it for diagnostic recovery.

Process inventory is mandatory stop-safety evidence. If the platform process
scan or service-manager status cannot be read, that unknown state is never
treated as `not_running` or as permission to uninstall, replace, prune, or
register a carrier. Lifecycle mutation stops with the preserved diagnostic
error; read-only product surfaces may present the state as unknown.

An operating-system-managed hidden `service run` is supervisor bootstrap, not
an interactive CLI entry. It resolves and validates the lane-local Service
contract before human entry policy, does not fetch remote profile lists, and
uses local validation and repair (`validateRemote: false`) so a launchd or
systemd restart cannot depend on a user prompt or network profile lookup.
Interactive `service run` keeps the ordinary authenticated command-entry
policy.

Before a controlled lifecycle stops or drains the current Service, it must
fully prepare and validate the replacement bundle without changing the active
bundle pointer. A preparation failure leaves the current Service, its
registration, and its desired running state untouched. Only a prepared bundle
may enter the destructive lifecycle. Activation happens after the old Service
is confirmed absent; an abandoned prepared bundle is removed unless it became
the active bundle.

Stopping and starting use separate evidence budgets. Teardown keeps its bounded
15-second absence check. Replacement startup uses the platform startup budget
(90 seconds for launchd) and polls the full lifecycle inventory for its entire
budget; an alive manager without a fresh runtime lease is still pending, not a
reason to restart after 15 seconds. At the deadline, lifecycle records the exact
final inventory and job diagnostics, then performs at most one bounded verified
rollback. It must not insert an unverified stop/start retry before that rollback.

An OpenMeld Service update request has been accepted and started in the
background only after a lane-scoped, strictly validated update job and prepared
replacement have been handed to an operating-system-owned update worker. That
handoff is not update completion. Web Setup, Center Agent actions, the ordinary
Service command, and top-level CLI upgrade must all converge on this one
coordinator. The initiating browser or Terminal is not a lifecycle owner: it
may close immediately after the durable handoff, and the OS worker must resume
the same job after its own crash, sign-in, or computer restart.

When the control endpoint is absent, the update worker delegates to the existing
locked lifecycle checks rather than waiting forever for an absent Service to
answer readiness. This does not authorize force-killing a live Service: controlled
drain or verified runtime absence remains required. Setup joins pending updates;
a newer Setup advances an older waiting job through that same coordinator before
joining it, so an old worker cannot replace a newly connected Service afterward.

That update job is the single operation truth. Its safe projection reports one
of `waiting_for_work`, `updating`, `updated`, `restored`, or `needs_help` plus
the opaque operation id, request source, target version, urgency, and
timestamps. The Service includes this projection in its normal local-component
capability report; Core, Web, CLI, and Center Agent must read that projection
instead of inferring progress from connectivity, component versions, or their
own request lifetime. Local paths, commands, and raw error text remain local.
Completed operation phases remain visible for at most 24 hours. Core must omit
an older `updated` phase when current component evidence already shows another
actionable update. A completed historical operation must never contradict the
current update action.
`waiting_for_work` and `updating` are in progress. `restored` and `needs_help`
are failed outcomes even if stale component fields happen to show the target
version. `updated` proves that the worker finished installation; clients still
retain that exact operation and verify both CLI and Service at its target before
presenting **Up to date** or allowing Setup or Prepare to report completion.
Same-operation observations are ordered by `updatedAt` and phase, so a stale
projection cannot move visible progress backward.
An explicit later repair may establish a fresh running, anomaly-free Service at
the current CLI version. Setup may use that verified replacement to recover
from a completed historical failed update at that version or older; it must
retain the historical failure and must not apply this exception to an in-flight
update or merely installed artifacts. Account alignment remains independently
required by the participation gate.
Because runtime capability payloads are strict, rollout deploys the accepting
Schemas and Core before publishing a Service that emits `updateOperation`.
New Core accepts older Services that omit it; rollback removes the new local
Service before rolling Core back.

OpenMeld Tools maintenance uses the same operation identity across both stages:
the CLI or running Service records a durable download/install request and wakes
the OS-owned maintenance worker. That worker alone executes the attempt; the
new CLI hands the same operation to the Service update job above. The Service job
becomes the projection owner as soon as the handoff exists. A computer with no
saved preference enables automatic OpenMeld Tools updates; an invalid preference
fails closed and reports maintenance attention. Automatic requests obey that
preference, while an explicit user request still runs when automation is off.
Maintenance reads only the owning device preferences file (or the supported
legacy preference before migration). Broken Skills or controller state cannot
disable that read. Local configuration mutations hold the existing configuration
lock and modify only their owned fields and files, preserving unrelated fields.
Unknown file versions and malformed owned files cannot be overwritten by a
setter. Legacy migration fills missing split files, never replaces an existing
split file, and removes its source only after all split files are supported.
Empty owned files remain explicit so an interrupted migration cannot resurrect
deleted settings. The filesystem layout marker likewise rejects a newer version
without modifying it. This release continues writing v1; it adds no new local
format or minimum-version requirement.

Maintenance is installed alongside the Service, rather than only after the first
update request. Its separate CLI entry does not initialize the business command
graph, filesystem-layout migration, account selection, or Skills inventory.
Sign-in and hourly OS triggers can discover a release even when business startup
fails and no update request exists. The Service no longer owns a parallel hourly
update loop. The persisted background/stopped intent and automatic-update
preference remain authoritative; maintenance does not override an explicit stop.
One cross-process request lock preserves the operation identity across CLI, Web,
and scheduled requests; a separate worker execution lock prevents concurrent
installers without holding the request lock throughout downloads or active work.
Maintenance verifies the OS registration belongs to its installation before
downloading, then rechecks under the lifecycle lock before switching the Service.
A worker left behind after another installation claims the same lane must stop
without changing that installation. Windows ownership comes from the registered
task action and its environment, not from an obsolete batch file.

Local runtime metadata uses a pinned disk-format epoch, independent of the
Runtime Transport epoch. A protocol change alone must not erase runtime data.
Supported v1 legacy repair remains available; a future incompatible local format
requires versioned readers before new writers. Newer metadata versions and actual
read errors stop migration without changing the data.
For a Service that supports release-triggered maintenance, Core uses the
existing Runtime Transport connection to request one automatic recheck when
Core's stable-channel release manifest first becomes actionable for that
computer. Register and heartbeat triggers both pass that manifest explicitly;
a missing manifest cannot infer an automatic target from local defaults. The
request requires the Service's explicit `requestAutomaticUpdate` capability,
obeys the Service-owned automatic update preference, and coalesces by computer
daemon session, and release target while the request is in flight. It retains
that marker only when the same Service session reports `current` at or above
the release, or reports a `started` or `already_running` operation targeting at
least that release. A replacement Service session or a newer release target
can request immediately. An `unavailable` response clears the in-flight marker
and records a hibernation-safe retry throttle in Durable Object storage: retry
after 5 minutes, then 15 minutes, then 60 minutes, capped at 60 minutes while
the same computer, daemon session, and release target remain current. `disabled`,
an invalid response, or a reported current or operation target below the
release clears the marker so the next register or heartbeat can retry. A
disconnected request is failed immediately so a
replacement Service can retry instead of waiting for the control timeout. It
never adds a second updater or a faster polling loop. The published Service
still checks the release channel after startup and every hour as the
missed-signal fallback, bypassing the normal CLI command cache for this
maintenance check. An explicit update request also refreshes the release
channel before deciding that the computer is current.
The Service resumes a saved attempt immediately after restart and never waits
for the downloader when the Service itself must stop. Dev and canary lanes do
not check or install the published channel.

Web and the Center Agent do not execute update commands. They send one strict
owner-scoped control request through Core and Runtime Transport to the current
account/device/lane Service. That Service invokes the same coordinator used by
CLI and automatic maintenance. The request may start an update or change the
computer's saved automatic-update preference; it cannot run arbitrary shell or
target another member's computer. An explicit update remains available when
automatic updates are off. Older Services that do not advertise the control
capability fail explicitly and keep Setup/Reconnect as the recovery path. Core
never infers automatic-request support from a package version.

For an `available` update, the current Service keeps admitting new Wake work
while the prepared replacement waits for a safe switch. For a `required`
update, Core blocks affected new Wake work and the worker enters the controlled
drain immediately. Neither policy may terminate already accepted work. The
safe-switch fact is false while either an accepted Wake remains in flight or a
durable result still awaits Core's acceptance receipt; process exit alone is
not sufficient evidence. Each accepted Wake stays on the Service version that
accepted it, and an update must never retry or silently replay it.

Waiting for that safe-switch fact must not hold the Service lifecycle lock.
The worker uses one short lock transaction to normalize the pending job before
waiting, then re-reads that job under the lock before the switch and
verification phase. A waiting worker may write an error only when the durable
job still names the same target, prepared bundle, urgency, phase, and attempt.
This allows a newer request to replace an older prepared target or a required
request to escalate an available one without a stale worker restoring the old
state. Requests coalesce into the existing operation; they never create
parallel Service update lifecycles.

After the safe switch begins, RuntimeCoordinator remains the in-flight Wake
authority. New Wake work may wait for the replacement route and resume after
the Service reconnects, but it must not be duplicated or converted into an
early local timeout failure. Before delivery, RuntimeCoordinator persists the
owning device and lane with the delivery provenance. A replacement session may
therefore recover an unaccepted delivery after a Durable Object restart even
when the old in-memory session no longer exists. Reconciliation re-reads the
durable command inside the per-execution serializer, so concurrent reconnect
triggers produce at most one replacement delivery. Older commands without that
durable route identity fail closed. The update job is complete only after the
target Service reaches its verified desired state. Replacement startup or
health verification failure must restore and verify the previous Service before
the job records failure. Uninstall and reset remove the background update
worker and its lane-owned disposable state.

A previous binary is eligible as last-known-good only when its executable and
fingerprint are still verifiable and its version is at or above Core's cached
minimum supported Service version. A rollback below that floor is rejected and
the current version is left in an explicit stopped-safe state; the system must
not create a process that appears healthy locally but is known to be rejected
by Core.

The binary update worker runs from a stable lane-owned carrier, not from a
version directory. A self-contained npm update worker uses a stable lane-owned
launcher that imports one verified bundle. Successful Service verification may
atomically replace the carrier or launcher; the running worker must never unload
its own OS registration as part of that replacement. Bundle cleanup treats the
launcher, OS registration, and durable pending job as recovery references, so neither the
registered carrier nor the replacement target can be removed while the handoff
is recoverable. Migration may likewise protect a legacy worker's pinned managed
version in addition to the current and rollback versions.

An installation without independent maintenance must copy and verify its worker
and establish the OS registration before publishing the initial pending job.
An existing independent worker stays in place until the target Service is verified.
When replacing a pending target, every resource referenced by the current
durable job remains recoverable until the replacement job is atomically
committed; replacement must not disruptively re-register the already-owned OS
worker before that commit. Preparing the stable binary worker carrier and
committing the durable replacement share the managed-install transaction lock,
so another CLI install cannot prune the new target between preparation and
commit. The existing worker is started after the commit and before cleanup, so
cleanup failure cannot strand a durable required update. Managed-version
pruning uses the same lock and re-reads the current CLI pointer and durable
pending target inside that lock. It then keeps both, plus one verified rollback
version. Cleanup failures remain observable but do not undo a durable worker
handoff.

Controlled update, reinstall, and repair use a quiesce-and-drain stop. The
Service first rejects new dispatch admission with `service.draining` while
preserving dedupe for already-owned work. It keeps the current Runtime
Transport socket connected, continues heartbeats and execution progress,
waits for active local execution slots, flushes the existing durable dispatch
result outbox, and waits for Core's durable-acceptance receipts before closing
the socket. If the socket disappears during that wait, unacknowledged results
remain in the same durable outbox for the next Service session; lifecycle code
must not create a second result store.

The active-work drain has no fixed wall-clock deadline while execution remains
live. Once active work has drained, result-receipt and WebSocket-close waits are
bounded: an unacknowledged durable result remains available for replay, and a
half-open socket is terminated after its close deadline. The calling lifecycle
also bounds the control request so a new CLI cannot wait forever on an older
Service. That timeout is a compatibility fallback only during an actual version
upgrade; the existing OpenMeld-owned-process and long-stalled-heartbeat checks
remain mandatory before any automatic force kill.

Repeated process-discovery failures are aggregated within a bounded local log
window, retaining the first occurrence, count, duration, affected controller,
and recovery event. Local diagnostics preserve stable reason codes including
`process_discovery_timeout`, `controller_check_timeout`,
`result_ack_timeout`, `socket_close_timeout`, and
`service_reconnect_exhausted`; immediate reconnect exhaustion remains degraded
evidence while background reconnect attempts continue.

`agentReplyContextReview: true` is an additive Runtime Transport capability.
A Service advertises it only when it can keep a `post_message` result as an
unpublished proposal, receive `review_required`, remove that proposal from the
result outbox, read a bounded Space delta, and resume the exact Agent Controller
conversation. Each review carries the original source message, source signal ID,
and target Profile alongside the bounded newer-message delta. The original Wake
remains the assignment; another Agent's contribution is context, not a new
activation or a transfer of task ownership. The same execution slot stays active across review. Review never
starts a new Wake, repeats completed tools, or creates a second result store.
Older Services omit the capability and must never receive the new response
status.

For an operating-system-managed Service, lifecycle code disables automatic
restart and sends the existing local `shutdown` control-plane request before it
unloads the service definition. The Service acknowledges that request only
after its Runtime Transport socket session has completed the drain above. New
CLI with an older Service may fall back when the additive handler is
unsupported. That compatibility fallback is limited to an explicit control
plane contract mismatch, an `accepted: false` response from the older Service,
or the exact version-bounded pre-`0.2.88` shutdown defect where the Service has
completed its drain but reports `daemon.run.socket_closed` with
`code=1000, reason=closed` because the transport omitted the close reason.
Missing credentials, other socket failures, malformed responses, and all
errors from `0.2.88` or newer Services abort the lifecycle before the service
manager stops the live process. Explicit forced reinstall keeps its bounded
destructive path and does not wait indefinitely for the graceful
acknowledgement.

Lifecycle evidence carries one bounded stop cause:
`user_stop`, `controlled_service_update`, `service_crash`,
`network_disconnect`, or `unknown`. A lifecycle command records its explicit
intent before sending SIGTERM so the Service does not guess that every SIGTERM
is a deploy. An unexpected process exit is `service_crash`; a lost cloud socket
without a matching controlled cause is `network_disconnect`; missing evidence
stays `unknown`. The lifecycle journal, Runtime Transport heartbeat/trace, and
user-visible failure projection preserve this cause without treating it as
execution authority. Before an explicit user stop closes its socket, the
Service sends one final heartbeat with `acceptingDispatches=false` and
`stopCause=user_stop`. Runtime Transport uses that explicit intent to stop
reporting the Computer's Service as connected immediately; it must not wait for
the ordinary network-loss freshness TTL. Controlled updates and unexpected
disconnects retain the normal freshness window so replacement sessions and
brief transport loss do not make product status flicker.

The lifecycle stop path is SIGTERM-first with a bounded wait. When that wait
elapses, it may escalate to SIGKILL only for a daemon whose runtime lease
heartbeat has been stalled for at least ten minutes and whose pid the process
inventory attributes to an OpenMeld-owned background daemon; every force-kill or
skip decision lands in the lifecycle journal. This escalation does not
conflict with the in-flight Wake wall-clock guardrail: the trigger is an
explicit user stop request combined with the absence of the daemon's own
liveness evidence, never elapsed time on a live execution, and a daemon with
a fresh heartbeat is never force-killed. Heartbeat staleness here is local
stop-safety evidence only; it must not feed any liveness, readiness, or Wake
availability projection.

A forced stop is never presented as a controlled drain. The command must warn
before the destructive escalation, and the lifecycle journal must retain the
force-kill or skip decision so later diagnostics can distinguish operator
intent from a crash or network loss.

Lifecycle failures preserve stable typed error codes through the maintenance
outcome and Agent View. If a running Service has lost its control endpoint,
repair and update fail closed and explain the deliberate force command together
with its no-active-work precondition. They must not infer that a missing control
endpoint means no local Agent work is running or force-stop the process
automatically.

An exited process has no live command path to inspect. When its lease is stale
because the process is gone and the owned-process scan finds no matching
process, that absence is not a runtime bundle mismatch and must not request
system-registration repair. Preserve the stale-lease diagnostic and the normal
restart path. A live or observed process still requires the existing bundle and
command-path checks; independent bundle corruption remains blocking.

One narrow crash-loop recovery is deterministic rather than destructive: when
the local control endpoint is missing, runtime state is not running, and process
inventory finds no OpenMeld-owned Service process, a stale service-manager
`running` flag is treated as already stopped so repair can replace the
registration. If runtime or an owned process still exists, the same missing
endpoint remains a hard stop and no automatic kill is allowed.

Exact-controller recovery is capability-gated. A Service advertises
`resumeControllerConversation` only when its carrier can validate the frozen
execution, controller, conversation, working directory, and destination before
starting the adapter in repair mode. Core sends the resume frame only after
that capability and the current lease are present. An older Service therefore
keeps ordinary Wake, result replay, setup, status, and diagnostics behavior but
cannot expose **Continue conversation**. Because older Core uses strict
Runtime Transport schemas, the cloud receiver must deploy before a Service
that emits the new capability, heartbeat drain fields, or recovery frames.

Every local adapter repair turn must preserve the validated canonical
conversation identity and the Binding's controller-native permission intent.
When repair needs temporary controller settings, the adapter must use a native
isolated child conversation and apply those settings only to that child. The
adapter must return the validated canonical identity, and the shared dispatch
boundary rejects a repair result that reports a refreshed or different
conversation instead of rewriting it. A later ordinary Wake must still use the
saved Binding permission mode or OpenCode permission JSON.

Codex exact-controller recovery copies the canonical conversation into an
ephemeral App Server fork and applies the conservative repair approval and
sandbox policy only to that fork. Claude Code repair resumes through an Agent
SDK or CLI fork and applies its temporary Plan mode only there. OpenCode repair
uses the official Server session fork and passes the Binding's unchanged
`OPENCODE_PERMISSION` JSON to the child. Each adapter continues to report the
validated canonical conversation identity. If the installed controller cannot
create the required isolated child, repair fails explicitly while ordinary
Wake, setup, status, and diagnostics remain available.

Repair also fails explicitly when the canonical conversation no longer exists.
The ordinary-Wake context-heal path must not create a new conversation during
repair and then present it as the missing canonical conversation.

Cursor ACP and Grok Build ACP do not currently expose the native fork required
for a temporary repair policy. Their repair turns therefore keep the exact
Binding-selected native permission mode on the canonical session and must not
apply a repair-only permission override. A future repair that requires such an
override must fail explicitly until the controller exposes a proven isolation
surface. OpenClaw action repair likewise keeps the exact canonical Session and
saved provider/tool policy while adding only the temporary dispatch-scoped
first-party plugin. It must not apply a broader repair-only permission override;
a future OpenClaw repair that needs one must fail until a proven isolated fork
surface exists.

Human-facing copy should use simple product language. Internal repair terms and
raw anomaly codes belong in Agent View or diagnostics.

## Owner Boundaries

This document owns the local OpenMeld Service architecture boundary.

Use scoped owner documents for related rules:

- `developing/product/product-model.md`: the overall product promise.
- `developing/product/projects.md`: Project identity, local connection, and
  Project-aware Wake product semantics.
- `developing/architecture/agent-transport-contract.md`: final readiness, Wake
  execution, and final outcome contract.
- `developing/clients/cli.md` and `developing/clients/web.md`: client-specific
  presentation and interaction responsibilities.

## Service Thin Core Refactor Map

The Service Thin Core line is the current simplification path for OpenMeld Service.
It keeps the product promise intact while reducing OpenMeld Service to a local worker
execution carrier.

Use this marker in source comments for code that belongs to the new core line:

```text
OPENMELD_SERVICE_THIN_CORE
```

The marker means the code is part of one of these explicitly scoped groups:

| Group              | Meaning                                                                                                                                                                                                                                                                    | Current primary files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carrier            | The local service run loop: owner/device/lane identity, adapter container, socket session, registration, heartbeat, reconnect, and route-catalog sync.                                                                                                                     | `clients/openmeld-cli/src/local-service/carrier/service-runner.ts`, `clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts`, `clients/openmeld-cli/src/local-service/carrier/register-session.ts`, `clients/openmeld-cli/src/local-service/carrier/heartbeat-loop.ts`                                                                                                                                                                                                                                                                                                   |
| Execution          | RuntimeCoordinator delivery intake, local execution slots, local runtime invocation, pending-interaction registry and response delivery, progress frames, result evidence, and result outbox.                                                                                | `clients/openmeld-cli/src/local-service/dispatch/execute-dispatch-task.ts`, `clients/openmeld-cli/src/local-service/dispatch/send-dispatch-result.ts`, `clients/openmeld-cli/src/local-service/dispatch/dispatch-result-outbox.ts`, `clients/openmeld-cli/src/local-service/execution/dispatch-runtime-preparation.ts`, `runtime/local-service/src/pending-agent-interaction-registry.ts`, `runtime/local-service/src/serial-agent-interaction-callback.ts`, `runtime/local-service/src/local-execution-slots.ts`, `runtime/local-service/src/dispatch-queue-routing.ts`, `runtime/local-service/src/dispatch-continuity.ts` |
| Runtime Inventory  | Detection and reporting of local agent controllers and capabilities. It is local evidence, not final product readiness.                                                                                                                                                    | `clients/openmeld-cli/src/local-service/inventory/agent-controller-inventory.ts`, `clients/openmeld-cli/src/local-service/reporting/runtime-agent-controller-reporting-submission.ts`, `clients/openmeld-cli/src/local-service/reporting/runtime-agent-controller-report-sync.ts`, `clients/openmeld-cli/src/local-service/reporting/selected-agent-controller-reporting.ts`, `clients/openmeld-cli/src/local-service/adapters/resolve-daemon-capabilities.ts`, `clients/openmeld-cli/src/local-service/routing/resolve-controller-support.ts`, `runtime/local-service/src/adapters/*` |
| Lifecycle          | Install, update, repair, start, stop, bundle, launchd/system-service, runtime-state projection, lane-root management, and local service demand checks. It may restore the local carrier, but it does not decide final product readiness.                                   | `clients/openmeld-cli/src/commands/service.ts`, `clients/openmeld-cli/src/local-service/lifecycle/local-service-demand.ts`, `clients/openmeld-cli/src/local-service/lifecycle/*`, `clients/openmeld-cli/src/local-service/state/runtime-state-tracker.ts`, `clients/openmeld-cli/src/local-service/state/runtime-contract-guard.ts`, `runtime/local-service/src/startup-command-capability.ts`, `runtime/local-service/src/service-reconcile-decision.ts`                                                                                                                              |
| Diagnostics        | Read-only or explicitly diagnostic evidence that explains the local link. It must not become a second readiness, Binding, Wake outcome, or Space truth owner.                                                                                                              | `clients/openmeld-cli/src/commands/service-trace.ts`, `clients/openmeld-cli/src/local-service/diagnostics/*`, `clients/openmeld-cli/src/local-service/status/*`, `clients/openmeld-cli/src/local-service/dispatch/daemon-dispatch-journal.ts`                                                                                                                                                                                                                                                                                                                                          |
| Legacy Proof Logic | Existing code that still speaks in Prepare, readiness, route, Binding, or service-health terms while helping setup or execution. This code is not automatically wrong, but it must be treated as a candidate for extraction, rename, demotion to diagnostics, or deletion. | `clients/openmeld-cli/src/start-local/*`, `clients/openmeld-cli/src/system/reply-readiness.ts`, `clients/openmeld-cli/src/system/current-reply-readiness-snapshot.ts`, `clients/openmeld-cli/src/system/action-participation-planner.ts`, `clients/openmeld-cli/src/local-service/routing/route-catalog.ts`                                                                                                                                                                                                                                                                            |

The current codebase has one local-service implementation layout:

```text
clients/openmeld-cli/src/local-service/  host-bound service loop, lifecycle, inventory, reporting, diagnostics, status, and execution
runtime/local-service/              private package for reusable local service carrier policy and pure service helpers
runtime/local-execution/            local execution kernel helpers used by the service carrier
```

Do not add new implementation code under `clients/openmeld-cli/src/daemon`. That
path is retired. If a helper is reusable carrier policy and does not need CLI
auth, lane, profile, presenter, or transport state, put it in
`runtime/local-service`. If it needs those host concerns, keep it under
`clients/openmeld-cli/src/local-service` until the dependency can be injected through
a clean host boundary.

The target internal CLI layout is:

```text
clients/openmeld-cli/src/local-service/
  carrier/        service loop, socket session, register, heartbeat, reconnect
  execution/      RuntimeCoordinator delivery, local slots, runtime invocation, result evidence
  inventory/      local agent controller detection
  reporting/      runtime/controller evidence submission
  lifecycle/      install, update, repair, start, stop, bundle, service manager
  diagnostics/    read-only traces, journals, and diagnostic projections
  status/         service status snapshots and presentation

runtime/local-service/
  adapters/       local adapter assembly helpers that do not depend on CLI state
  *.ts            reusable carrier policy, execution slot, control-plane, and diagnostic helpers
```

`runtime/local-execution` is the local execution kernel support package for
ledger state, runtime task orchestration, agent context policy, scheduler
policy, result envelopes, and recovery policy. Do not treat it as a user-facing
local service owner. Fold `runtime/local-execution` into `runtime/local-service` only
after both localhost and production smoke pass.

The intended target chain is:

```text
OpenMeld Service starts
-> identifies account/device/lane
-> detects local runtime capabilities
-> registers runtime/capabilities
-> heartbeats
-> accepts RuntimeCoordinator task
-> starts local runtime
-> reports progress, privacy-bounded tool activity, result, and failure evidence
```

Work-summary activity is optional execution evidence. Agent adapters map
provider events to OpenMeld-owned admitted semantic work keys before the Local
OpenMeld Service sends them. A command is classified by a reviewed operation,
such as cloning one safely labeled repository or running project tests; unknown
commands do not become generic `Ran a command` rows. The Service never forwards
tool arguments, results, raw errors, command text, paths, file contents, or
private Agent output through this frame. Core still validates the current
RuntimeCoordinator token, execution identity, daemon session, lease, and
authoritative Space placement; emitting a frame does not give the Service Space
or execution authority.

The Service Thin Core line must not reassign ownership:

- RuntimeCoordinator remains the in-flight Wake execution truth.
- Space remains the final visible reply, explicit visible stopped outcome, or
  explicit visible failure surface.
- Agent Profile and Binding remain identity and execution-connection truth.
- Core-owned Wakeability remains the final user-facing verdict; the current
  compatibility implementation is `AgentExecutionReadiness`.
- OpenMeld Service evidence remains local execution evidence.

The next extraction target after the marker pass is a local runtime inventory
surface. That surface should answer only:

```text
What local controllers/capabilities are detected on this computer, and what
local blocker prevents each one from being launched?
```

It must not answer final Wakeability, create Binding truth, join Spaces,
or claim a Wake outcome.

## Architecture Invariants

- OpenMeld Service is the local execution carrier and trust boundary.
- OpenMeld Service carries local controller and capability execution; it does not own
  product identity.
- OpenMeld Service does not own Space truth, Agent Profile identity, final readiness
  truth, or RuntimeCoordinator execution truth.
- Account, device, and lane evidence must align before setup or repair can claim
  the promised reply path is ready.
- Prepare may prepare local Runtime readiness and capabilities; it must not
  create Space truth, Binding truth, Wake work, execution ownership, or final
  readiness truth.
- Service health does not equal product readiness.
- Current-device Project operations may inspect and immediately return local
  paths only to the requesting owner; cloud and shared contexts never store
  those paths.
- `OpenMeld CLI update available` is advisory CLI package freshness drift and must
  not block replies by itself.
- `Update OpenMeld Service` and `Update OpenMeld skills` are required local component
  alignment actions in the current early product phase. They flow through
  `openmeld setup`, not through a separate user-facing state chain.
- Human View gives clear product guidance; Agent View keeps machine-readable
  diagnostics.
- Setup and repair must not report success from process start or inventory
  detection alone.
