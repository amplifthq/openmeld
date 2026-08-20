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

Prepare must not:

- create or join a Space
- create Agent Profile Binding truth as a side effect
- choose Space members
- send a Wake
- decide execution ownership
- decide final Wake outcome
- decide final user-facing Wake availability

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

The selected launch contract remains the install and update identity. When an
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
- final `Available for Wake` truth
- RuntimeCoordinator execution truth
- the user's model intent stored on a Binding

Provider Usage Limits are capacity evidence, not execution authority. Each
controller projects one optional list of stable limit keys, plain-English
labels, 0–100 used percentages, reset times when reported, observation times,
and honest states. An adapter must leave an unknown percentage or reset time
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
`unsupported`. These states do not alter Agent Profile readiness, Binding, Wake
admission, RuntimeCoordinator, routing, or agent selection.

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

Codex resume may use the smaller per-turn input only when the `thread/resume`
response proves that `thread.threadSource` matches the exact current
instruction-epoch marker. A legacy thread, an epoch mismatch, or missing source
evidence must use the complete fallback prompt. Resume and fork do not replace a
Codex thread's developer instructions, so they must not be used to retrofit a
legacy thread.

Codex App Server resume is a bounded admission step, not the execution itself.
OpenMeld requests metadata-only resume without replaying historical turns,
because the Service needs the controller conversation identity, model, and
instruction source rather than a duplicate copy of provider history. If an
existing controller conversation is missing or does not acknowledge resume
within the short resume admission window, the adapter starts one fresh thread
and delivers the complete current instruction plan exactly once. The resulting
context delta replaces the inaccessible provider conversation transparently;
a person must never be asked to create a new Task or Space to repair it.

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

Owner policy reads and writes target the current Computer's exact device and
lane plus its live owner Service session. They do not require a registered or
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
auth, and version evidence where they are the only stable local proof. ACI
should expose only facts it can prove rather than inventing parity fields.

Cursor dispatch uses only the official Agent Client Protocol exposed by
`cursor-agent acp`; OpenMeld does not maintain a second Cursor print-mode
adapter. ACI detects the `cursor-agent` executable itself, never the generic
`agent` command or the presence of Cursor IDE state. It reports the CLI build,
`cursor-agent status` authentication evidence, ACP as the native interface,
model selection, permission-mode selection, native event streaming,
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
  setup. When the command includes a Web-issued one-time token, the CLI must
  exchange it for a durable local CLI sign-in session for the same OpenMeld account;
  OpenMeld Service uses that local session when it starts at login. The handoff must
  not be used to add an agent-selection step to Web.
  Keeping the legacy Web selector retired is a setup-flow
  consolidation owned by this document; it has no ordering dependency on the
  onboarding planner (`developing/product/onboarding.md`), which treats
  "connect this computer" as one atomic decision and never models setup
  internals.

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

An explicit Off decision is sticky. Setup, service restart, catalog refresh,
binary update, controller reinstall, and later controller detection must not
turn that controller back on. Only an explicit current-service enable command
or an explicit CLI agent enable command may reverse it.

## Current-Device Project Operations

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

## Local Folder Picker

Local Folder Picker is a current-Computer, owner-self interaction capability.
It lets an authenticated Web action ask the exact live OpenMeld Service to open
the operating system's folder chooser on that computer. It is a sibling of
`computerFileAccess`, `localProjectControl`, and `localAgentControl`; none of
those product contracts owns it.

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

## Service Health And Product Readiness

Service health is not product readiness.

A service can be installed, running, or able to report local inventory while the
Agent Profile still cannot reply in the current Space. Local service evidence is
one input to the product reply path, not the final answer.

Final user-facing readiness belongs to the transport readiness contract. Agent
Profile surfaces, Web setup, CLI guidance, and Space membership displays must
not recompute final Wake availability from service health alone.

OS service manager job-state evidence (for launchd: `launchctl print` runs,
state, last exit code, and pended-spawn markers) is startup failure diagnostic
evidence only. After a startup wait fails it may drive failure cards, the
lifecycle journal, and Agent View diagnostics — for example distinguishing a
job macOS never spawned (Login Items blocked) from a crash loop with a nonzero
exit code. It must never feed service health, Wake availability, readiness, or
lifecycle decisions.

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
local evidence only. It does not make an Agent Profile `Available for Wake`,
reserve execution, or decide the final Wake outcome.

When every route came from negotiated expected-routes `v3`, the Service also
advertises `profileConfigurationRevision: true` and reports each route's
`bindingId` and `configurationRevision`. Runtime Transport compares that applied
identity with the identity frozen for the accepted dispatch. A mismatch returns
`daemon.profile.configuration_not_synced` before local execution starts. The
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
`AgentWakeAvailability` and `AgentExecutionReadiness` combine it with Binding,
transport, compatibility, and policy evidence into the user-facing status.

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

- The projection response is operation-scoped evidence. It is never persisted,
  and the route catalog cache remains a failure fallback only.
- Carrier startup and periodic catalog refresh only check existing local
  projection and workspace state. Setup and explicit repair own mutations;
  catalog reads must not run repair work or block healthy routes behind it.
- One catalog load has one bounded total deadline. A phase that does not settle
  must fail with its phase name and measured duration so startup can recover
  from the last accepted cache, or start empty and retry when no cache exists.
  It must never leave route registration permanently pending.
- One catalog load resolves its account context once and reuses it for every
  Profile workspace inspection. It must not fan out identical Keychain reads
  per Profile.
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
it does not decide service liveness, Wake availability, or a public route
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
must never be promoted into Agent Profile readiness or Wake availability.

## Service Freshness And Compatibility

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

On macOS, the managed LaunchAgent uses `RunAtLoad=true` and `KeepAlive=true`.
The npm distribution invokes its generated OpenMeld-owned wrapper through
`/bin/sh`, while the binary distribution executes the prepared managed binary
directly. The user-facing stop path must disable the LaunchAgent before booting
it out, so explicitly stopping OpenMeld Service is respected instead of being
immediately undone by launchd.

The OS service manager registration is a per-user global resource keyed only by
the env preset. `OPENMELD_HOME` isolates lane files but does not isolate this
registration, so any process that mutates a service registration must fail
closed unless its lane intent is unambiguous: test processes must never mutate
the published production registration, and a process whose effective root left
the published production lane must state an explicit `OPENMELD_ENV_PRESET`
before mutating the production registration. Isolated validation targets the
`dev-local` or `canary` service identity or stubs the service manager.

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
definition, the daemon keeps a preset-owned durable repair-pending marker and
continues the same repair on later passes. Because the OS registration is
global per env preset, the repair marker and daemon lifecycle lock use one
canonical preset-owned path that deliberately ignores `OPENMELD_HOME`
overrides. Registration repair, install, start, stop, uninstall, alignment,
auto-heal, idle auto-stop, and explicit autostart changes all reuse that one
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

Release policy decides whether that update action is advisory or blocking.
`available` means a newer Service is available and current Wake work can
continue. `required` means the Service must be updated before the affected
capability can receive new Wake work. Independently, Core keeps a monotonic
minimum supported Service version for versions already proven unsafe. A Service
below that floor always receives an effective `required` projection and cannot
receive new Wake work, even when the latest release itself is advisory. This
keeps healthy supported Services eligible without allowing a later optional
release to re-enable a known-broken Service.

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

Repair succeeds only for the component it repairs. It must not claim success
just because a process started, local files were rewritten, or inventory was
detected, and it must not project service health as final Wake availability.
The top-level command entry owns interactive authentication. Nested lifecycle
and background-start operations run only after that entry decision and must not
open another authentication prompt. A cancelled start remains `cancelled`; it
must never be normalized into a completed-but-stopped repair or trigger an
automatic retry loop.
Repair first compares the intended bundle, service-manager registration,
runtime contract, saved desired state, and effective running state. When those
facts are already aligned, repair succeeds without stopping or rewriting the
Service. Only a decision that requires mutation enters the controlled lifecycle
below; an explicit forced repair may enter it for diagnostic recovery.

Before a controlled lifecycle stops or drains the current Service, it must
fully prepare and validate the replacement bundle without changing the active
bundle pointer. A preparation failure leaves the current Service, its
registration, and its desired running state untouched. Only a prepared bundle
may enter the destructive lifecycle. Activation happens after the old Service
is confirmed absent; an abandoned prepared bundle is removed unless it became
the active bundle.

Controlled update, reinstall, and repair use a quiesce-and-drain stop. The
Service first rejects new dispatch admission with `service.draining` while
preserving dedupe for already-owned work. It keeps the current Runtime
Transport socket connected, continues heartbeats and execution progress,
waits for active local execution slots, flushes the existing durable dispatch
result outbox, and waits for Core's durable-acceptance receipts before closing
the socket. If the socket disappears during that wait, unacknowledged results
remain in the same durable outbox for the next Service session; lifecycle code
must not create a second result store.

`agentReplyContextReview: true` is an additive Runtime Transport capability.
A Service advertises it only when it can keep a `post_message` result as an
unpublished proposal, receive `review_required`, remove that proposal from the
result outbox, read a bounded Space delta, and resume the exact Agent Controller
conversation. The same execution slot stays active across review. Review never
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

Exact-controller recovery is capability-gated. A Service advertises
`resumeControllerConversation` only when its carrier can validate the frozen
execution, controller, conversation, working directory, and destination before
starting the adapter in repair mode. Core sends the resume frame only after
that capability and the current lease are present. An older Service therefore
keeps ordinary Wake, result replay, setup, status, and diagnostics behavior but
cannot expose **Continue conversation**. Because older Core uses strict
Runtime Transport schemas, the cloud receiver must deploy before a Service
that emits the new capability, heartbeat drain fields, or recovery frames.

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
| Execution          | RuntimeCoordinator delivery intake, local execution slots, local runtime invocation, pending-interaction registry and response delivery, progress frames, result evidence, and result outbox.                                                                                                                                                | `clients/openmeld-cli/src/local-service/dispatch/execute-dispatch-task.ts`, `clients/openmeld-cli/src/local-service/dispatch/send-dispatch-result.ts`, `clients/openmeld-cli/src/local-service/dispatch/dispatch-result-outbox.ts`, `clients/openmeld-cli/src/local-service/execution/dispatch-runtime-preparation.ts`, `runtime/local-service/src/pending-agent-interaction-registry.ts`, `runtime/local-service/src/serial-agent-interaction-callback.ts`, `runtime/local-service/src/local-execution-slots.ts`, `runtime/local-service/src/dispatch-queue-routing.ts`, `runtime/local-service/src/dispatch-continuity.ts` |
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
- Core-owned `AgentExecutionReadiness` remains final user-facing readiness.
- OpenMeld Service evidence remains local execution evidence.

The next extraction target after the marker pass is a local runtime inventory
surface. That surface should answer only:

```text
What local controllers/capabilities are detected on this computer, and what
local blocker prevents each one from being launched?
```

It must not answer final Wake availability, create Binding truth, join Spaces,
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
