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

## Account-shared Bot adapter

`@openmeld/adapter-grok-bot` uses the official BDK credential and fixed public
Grok Bot API host. It only reads, messages and interrupts the existing session
pinned by the Binding. It never invokes the name-based get-or-create endpoint,
reads native-app cookies or creates a provider Bot. BDK account identity is an
Interface observation; Core still owns Wakeability and RuntimeCoordinator owns
each Wake's lifecycle.

This controller declares `conversationScope: account_shared`. It drains the
pre-dispatch cursor without publication and refuses a conversation observed busy
before submission. After submission, only provider-delivered `send-message`
entries are proposed through the existing dispatch-owned `reply` action. This
is an explicit shared-conversation delivery contract, not arbitrary stdout or
reasoning extraction. Concurrent messages in the original app can contribute
to these replies; there is no claim of task-exclusive attribution. The existing
action writer and Core publication checks retain authorization and finalization.

The adapter prevents overlapping dispatches to the same session within one
Service adapter instance. This is not an account-wide provider lock. BDK offers
no atomic task-specific admission or interrupt. A Stop targets the Bot's current
conversation, as acknowledged at connection, and the adapter waits for idle
evidence before returning `runtime.turn.cancelled`. An interrupt HTTP receipt
alone is not a stopped outcome. A failed read is an explicit failure with a
warning that provider work may continue, never manufactured settlement.

Independent contexts, local file boundaries and automatic delivery-only repair
are rejected. The provider keeps its existing tools and permissions. An
ambiguous message submission is not automatically repeated; stable message IDs
use the dispatch identity. Per-request network deadlines do not impose a total
execution timeout.

## Product Role

Version 2 handoffs can carry a brief alone or exact shared-file revisions without
a repository. They require an isolated Space-only Context with no Project or
inherited Agent-settings permission source. The Service uses its owned scratch
workspace and never resolves a default repository. Codex and Claude can receive
a brief; writable selected-file preparation remains Codex App Server only.
The complete brief is delivered even when no file copy is required.
Selected Skill releases and all their resources are prepared and revalidated
before execution even when no shared files are selected. Such work does not
create a file-copy receipt or gain writable Space-only access.
Dispatch preparation verifies the accepted route/Binding identity before choosing
the owned Space-only workspace. It does not consult Default Project folder
observations for that Context, so an unavailable default connection cannot block
repository-free work. Repository and ordinary current-folder tasks retain their
existing current-folder checks.
This preparation rule applies to all explicit Space-only Contexts, including
ordinary tasks without a handoff, whether the default folder is healthy or missing.

For a version 2 handoff with code, the Service resolves the admitted Project through
the receiving account's local connection and pins its exact published commit.
It never follows a sender-local path or substitutes the receiving HEAD. Code
keeps its repository cwd; explicitly selected Space file revisions use the
existing working-copy owner in a separate child directory. The Source Context,
Computer policy, and controller permission contract still govern preparation
and execution. Missing commits, changed account/Organization, and mismatched
Context selection fail before model work with the existing visible outcome.

Selected Space work reuses this carrier and RuntimeCoordinator. Before local
execution, the Service materializes the exact admitted file/Skill selection
into a fresh child of the isolated task workspace. It advertises the optional
`spaceWorkHandoff` capability on macOS only for selected-file preparation; unsupported routes fail with an
update-required outcome instead of running a prompt without its selected inputs.
Brief-only v2 handoffs need Context capability 5 but do not require that
selected-file capability. Codex App Server and the existing Space-only containment
verifier remain required for editable shared files without a repository.
Claude Space-only work uses the controller's native tool surface as its boundary:
`buildClaudeSpaceToolOptions` sets `tools: []`, `strictMcpConfig: true`, disables
hooks, removes additional directories, and exposes only the dispatch-scoped
OpenMeld MCP tools. The null filesystem-verifier result does not leave native
Read/Bash tools enabled. This contract is preserved even in the owner's native
bypass mode; it is not a claim of an OS filesystem sandbox.
A working directory or separate metadata directory is not itself an
OS security boundary.

Managed working-copy metadata lives under the effective lane root, outside the
Agent-editable task content. Its scope binds deployment URL, account,
Organization, Space, Profile, and copy identity on the current device. Per-copy
locks, frozen pending bytes, and acknowledged revision/hash records support
crash recovery without owning cloud file authority. Every network operation
rechecks the current account/Organization and uses ordinary authorized file
APIs. Unsent edits are retained across failures; account changes never migrate
pending uploads into another account. No automatic cleanup discards them.

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

The Service's separately supervised Execution Host owns one local-execution-slot
registry across replacement Runtime Transport sockets. Reconnecting the
connector never creates a new Host, empty slots, approval registry, or result
store. A Host process loss is different from socket loss: unconfirmed local work
must remain fenced before a replacement Host can admit anything, while
RuntimeCoordinator independently reconciles execution and final outcomes.

It does not own the product outcome by itself. A running service is useful
evidence, but the product question is whether the intended Agent Profile can
reply in the intended Space through the intended local execution path.

## Connector and Execution Host

One installation and updater deliver two processes. The Service runner owns the
cloud socket, heartbeat, reconnect, and existing lifecycle/control endpoint. Its
Execution Host assembles the existing adapters, execution slots, pending human
interactions, route discovery, controller reporting, and durable result outbox.
The Host never owns Core readiness, authorization, scheduling, or Space history.

The Host process ends with its supervised session. After Stop has drained
accepted work and the Host has released ownership, the Host ends every agent
CLI process tree it launched whose cleanup has not completed, then exits. At
that point such a tree can only be abandoned background evidence work, such as
a controller report still probing installed agent CLIs. A tree stays tracked
after its root exits until its descendant cleanup finishes, so a helper that
outlives its CLI is still covered. Cleanup first closes further agent CLI
launches in the Host, so background work still running, such as a report moving
on to its next probe, cannot start a tree behind it. The Host then sends
SIGTERM, allows a short grace, and runs the existing descendant cleanup, which
force-kills what remains; the whole step is bounded to a few seconds. Once a
tree's root has exited, its stored process-group ID is signaled only while no
live process holds that PID. A PID cannot be reused while it is the ID of an
existing group, so a live holder means the group may belong to someone else.
Cleanup then signals only processes a fresh scan finds carrying the
invocation's supervision marker. Every agent CLI cleanup applies this rule,
not only Host shutdown. That work must not keep the Host
alive: the Service waits for actual Host exit before it clears its runtime
lease, so a lingering probe would stretch every Stop past its bounded wait and
leave a following Start racing a Service that is still shutting down.

Connector registration, heartbeat responses, and transport errors are handled
only by `carrier/daemon-frame-transport.ts`. The inherited IPC contract excludes
those frames from `execution-host/frame-router.ts`; the Host has no connector
response waiters. Startup result replay and Agent enable/installation controls
stay with the Host. The connector derives
adapter capabilities from the Host's reported adapter IDs, not an in-process
adapter container. Mixed-version cloud negotiation remains a separate contract
and is not retired by deleting unused local implementation.

The connector retires a failed transport when its existing heartbeat failure
limit is reached, its PONG deadline expires, or the socket reports an error. It
releases the current session to the existing reconnect loop without waiting for
a native close callback. Retirement detaches the Host transport sink, rejects
pending transport responses, and ignores later frames from that socket. It does not cancel local
work or acknowledge retained results. Accepted queued tasks remain owned by the
Host across transport loss, keep their lifecycle reporting, and recheck the
current lease and Coordinator admission before starting the provider. Dropping
the queue on socket loss would leave an accepted execution without its carrier.
Permanent connector IPC loss instead rejects unconfirmed provider admission;
unstarted tasks settle through the existing result outbox before Host drain.
The failure reason is logged even when
the background Service uses a silent presenter; an observed close remains a
separate transport event.
Registered-session bootstrap reads and cache persistence yield to that same
transport exit, so a closed connection cannot remain held by local bootstrap.

Connection generations are independent of reconnect backoff attempts. Core
retains the accepted generation in the existing durable ServiceRuntime record,
scoped to owner, device, and lane, even after transient sessions or liveness
expire. New sockets advance that fence; a catalog registration on the same
socket retains it. Registration is acknowledged only after the record is
durable. Delayed writes cannot lower the fence. Legacy device-only records
migrate using their stored owner and lane, never inferred identity. Old records
remain fencing evidence, not proof that a Service is online or accepts work.

The runner starts its control endpoint and registers without waiting for Agent
inventory. Host initialization, reporting, and execution cross bounded inherited
IPC; they cannot block the connector's event loop. Host admission is closed until
its current-generation response confirms it is ready, and closes when that
observation fails. A shared Host failure may affect all its Agents, not the
independent connector. Last-known Host observations are not fresh health.
The negotiated Computer-care observation carries a bounded, path-free Host
failure code, safe explanation, and recovery action when initialization or a
health check fails. Core uses that same observation for owner Computer
readiness and Center Agent Computer reads; `responsive = false` without its
known cause is not an adequate operator diagnosis.

The runner records only changes to dispatch admission, with a bounded reason
from its current Host/connection observation. It includes the connection
generation and revision in the next heartbeat only when Core advertised
admission-evidence support in the register response. Old Core receives the old
heartbeat shape. This evidence explains a closed route in Trace; it does not
grant admission or replace the current Host health check.

Before local preparation and again immediately before each native provider turn,
the Host waits for a correlated acknowledgment of its existing lifecycle report
from RuntimeCoordinator. Core validates the execution token and records lifecycle
progress before acknowledging. A terminal refusal prevents provider invocation;
missing acknowledgment does not authorize execution or imply an execution failure.
Reconnect resends only the outstanding confirmation, never a provider invocation,
and acknowledgments from a retired connection cannot release the waiter.
The Service negotiates this capability before enabling Host admission. Older
servers leave new execution unavailable while connection and local control remain
usable; older clients do not receive unsolicited acknowledgment frames.

Only one Host may own an installation's execution resources. Before provider
work starts, a private process-incarnation receipt records non-quiescence. A clean
local drain clears that fence. After an unconfirmed owner loss, PID disappearance
alone does not prove that its children or side effects ended. The current receipt
records the Host process identity and each provider-owned process tree before
execution continues. A same-boot replacement is allowed only when that evidence
is complete, the exact Host incarnation is gone, and every recorded provider
process group or Windows job-backed root is gone. Missing process evidence,
legacy receipts, and corrupt records remain blocked; trustworthy operating-system
restart evidence is the fallback. This receipt contains no task results or
approvals and does not authorize replay. It is not a second execution ledger.
There is no automatic hot adoption or restart of unknown work.

Cloud-result acknowledgment is separate from local quiescence. Stop and update
readiness query the Host; they do not inspect another socket's private execution
maps. Long accepted work retains its existing no-total-timeout drain. The current
account-checked Stop coordinator still owns admission, confirmation, desired
state, and credential cleanup. This extraction does not authorize offline
Disconnect or change old-account result delivery during an account switch.

A normal Host stop is complete only after actual child-process exit. Connector
loss withdraws the transport sink and closes new admission; the Host retains safe
local drain and stored results. A subsequent socket reuses the same Host and
result identities rather than sending prompts again. Existing provider-specific
permission, launch, model, and cancellation contracts stay in their adapters.

The private Host entry is part of the same verified CLI/Service artifact. It
accepts only inherited IPC with the current parent, account/session, installation,
device, lane, and contract generation. It is not a public local server. Ordinary
Web/Desktop controls retain their existing interfaces. AHP, arbitrary preview
routing, new notification policy, and independent Host release channels are not
part of this replacement.

Cutover and rollback must quiesce both processes through the existing lifecycle
owner. An older binary does not understand the Host-incarnation receipt: never
roll back over uncertain new-Host work. Packaged/signed installation, platform
file-access behavior, and an actual old-to-new migration require separate
artifact acceptance; source or IPC fixture success is not that evidence.

## Ownership Boundary

### Local Agent connection setup

The optional `setupInstallations` capability extends the existing owner-scoped
installation-control transport with `setup` and `read_setup`. Core requires an
authenticated owner and explicit Computer/lane; neither URLs, shell commands,
package names nor credential contents are accepted from clients. The provider
adapter owns the fixed download, verification, install and official login steps.
Initially Grok Bot supports managed setup on macOS/Linux x64 and ARM64.

The Execution Host writes lane-local operation receipts before side effects and
holds the existing adapter idle guard until completion. Closing the Web dialog
does not stop setup. Request IDs cannot change action or replay a prior action.
An unfinished receipt after Host loss reports `outcome_unknown`; it is never
automatically replayed. Installation success requires a runnable CLI; login
success requires the official account check. Secrets and browser login output
stay on the Computer. Managed Node, BDK and credentials live under that lane's
`connection-tools/grok-bot` directory. Existing manual BDK installs remain valid.

Setup progress is not Wakeability. Inventory/report refresh still flows through
the existing Core projection and RuntimeCoordinator retains execution authority.
Old Services omit the capability and retain manual setup guidance. New Web does
not send setup operations to them. Existing update/select/enable operations and
Wake/Stop contracts remain unchanged; deploy the new receiver before the new Web
and Service capability. No database migration or mandatory epoch bump is needed.

### Local Agent installation updates

Owner Computer controls can update the selected Local Agent installation through
the existing installation-control transport. `updateInstallations` is an optional
capability, separate from installation selection. Core checks the authenticated
owner and explicit device/lane; clients send only installation and operation IDs.
The Execution Host rechecks the selected installation and uses its existing
adapter-operation guard. Active or queued work rejects the request; no update
queue or automatic retry is added. Accepted updates hold that guard until the
installer exits and the selected launcher's version has been checked.

The provider adapter owns installer eligibility and invocation. Initially only
Claude Code's native macOS/Linux managed launcher is supported. Its native
updater owns channel settings, managed policy, installer locking, and replacement
of the launcher for future sessions. App bundles, package managers, custom
launchers, injected arguments, and Windows retain manual maintenance. Advisory
shell text is never executable authority. npm's latest tag does not describe
native Claude's configured channel and is not used to label it outdated.

Lane-local operation receipts are written before installer execution. Repeated
operation IDs read the same receipt; IDs cannot move to another installation.
Socket loss does not cancel an update. An unfinished receipt after Host loss
is `outcome_unknown` and does not authorize replay or another automatic update.
The owner must use the provider's terminal maintenance path in that case.
Installer exit alone is insufficient: completion also requires the same selected
launcher and a readable resulting version. Report synchronization remains a
separate observation. Updates never own Wakeability or RuntimeCoordinator truth.

A retained Service reports the installed managed CLI version, not its own
carrier version. The CLI installer refreshes the existing local-components
snapshot atomically. Its CLI command contract is usable only when the snapshot
version matches the current managed executable. A missing or mismatched receipt
does not establish the newer CLI's contract; the report fails closed for that
contract while retaining the observed installed version.

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
A fresh running lease identifying a system-managed PID likewise takes precedence
over that same PID's path-based direct/unknown classification. Do not count one
verified system-managed process as both lifecycle owners; a different direct
process must still be reported independently.

A repo-local Service started under an explicit `OPENMELD_HOME` carries no lane
in its command line, so another custom home running the same entry looks
identical. Process inventory therefore attributes such a direct Service process
to the current lane only when this lane's runtime lease names its PID and that
live process started no later than the lease's `startedAt`. The comparison
uses the precision the OS reports: exact for Windows process creation time, and
by whole second for POSIX `lstart`, where a start inside the lease's own second
cannot be ordered against it and is accepted. The Service writes `startedAt`
after its own process started, while a process that reused a stale lease's PID
started after the owner exited, so the PID alone is never ownership. An
unreadable start time fails closed. Other copies of the entry stay
unattributed. This matters beyond diagnostics: the same inventory drives the
pre-start takeover and the stalled-stop force kill, which must never reach
another lane's Service. Without this, a still-running Service in
that lane, for example one finishing a controlled stop, has no observable entry
path and Start reports `runtime_bundle_mismatch`, demanding repair. The
pre-start takeover check reads the same inventory, so attribution belongs there
rather than in one caller: a live owner it cannot see would be treated as a
replaceable runtime.

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

First enrollment may attach the Core-owned connected Computer ID to an already
owned runtime without advancing its Service generation, only when every other
contract field is unchanged. This records the existing account/device/lane
association rather than replacing the carrier. Replacing an existing enrollment
or changing another identity or configuration field still advances the generation.
An explicit Stop may change only desired state to `stopped` and disable autostart
without advancing generation. The current carrier must retain ownership while it
drains. Stop still requires matching lease and contract generations. The next
explicit Start advances generation, so prior startup receipts cannot restart it.

Canonical Service contract writes and clears share the existing lifecycle lock
for the same resolved Service owner root, including ordinary installation.
The read, conditional comparison, and atomic file commit remain inside that
lock. Nested lifecycle operations reuse it; an explicit path input must select
the same root for the lock and contract file. Enrollment takes lifecycle then
auth ownership at commit, without network I/O under those locks. Auth may read
the current process's active pending Computer handoff candidate without refresh
or journal recovery, while checking its frozen journal ID, process identity,
Gateway, expiry and account. Ordinary account-checked controls still reject a
pending transition. Commit and rollback remain the existing journal's job.

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

An explicit `--local-agents none` request, including ordinary Desktop Connect,
must skip setup-owned Agent catalog discovery and repair. It still completes
the same authenticated Service alignment and persists an empty selection.
Service-owned background controller discovery and reporting remain independent
of the Prepare catalog used for an explicit Agent selection.

Background controller discovery submits each completed controller check without
waiting for unrelated controllers to finish. Submission uses the existing
per-controller report contract; it does not imply that unchecked controllers are
ready. Background probes run in a small bounded pool (three controllers at a
time). Every probe keeps its own timeout, so one slow controller cannot hold
back the other controllers' reports, while cold starts still do not compete
for the whole machine at once.

Core accepts a native controller check only for a fixed window after its check
time (`AGENT_CONTROLLER_AUTH_STALE_AFTER_MS`, two minutes). The periodic report
cadence is therefore measured from when a pass starts, not from when it ends, so
the time a pass spends checking never stretches the interval between two checks
of the same controller past that window. The next pass runs on its own timer
when it comes due; it must not wait for a heartbeat, because an idle heartbeat
stretches to a minute and a pass that just misses one would land on the
window's edge. Heartbeats may still start a due pass. A background pass may reuse a held
snapshot only while its native check is under 30 seconds old, measured from
the check time rather than probe completion, so a periodic pass always renews
the observation instead of republishing one that expires before the next pass.
A slow pass still leaves a short idle gap, and a failed pass settles only after
its in-flight checks finish. When a report does expire, Core keeps
the execution target `stale` for Wake eligibility, but the local-agent catalog
must not turn that missing evidence into `needs_repair`: only a launch blocker
carried by the last report may keep the launch status in repair.

Installation discovery, registration reconciliation, native checks, and reporting
form one per-controller pass. A scan must not wait for all installation probes
before publishing its first completed controller. Explicit controller requests
scan only their requested IDs. A newly committed registration may reuse that
pass's verified launch resolution only while its launch contract is unchanged;
a changed selection must be resolved again. Disabled registrations stay disabled.

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

Device inventory probes use an owned temporary directory outside Projects, not
the caller's or Service's working directory. Native cwd parameters (including
Codex skills/list and OpenCode's directory) use that same probe context. The
selected executable, user configuration, authenticated account, and environment
remain unchanged. Probe directories are removed after completion or failure.
Inventory skills describe user/global controller context; they do not describe
an incidental development repository. Actual execution continues to use the
selected Project workspace and its access checks. Successful device inventory
does not prove that a particular Project is accessible.

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

OpenCode inventory preserves native provider-qualified paths, including model
IDs with additional slash-separated segments. At the shared model-inventory
limit, a missing ID may have been truncated: consumers retain positive matches
but use the existing version-floor or unknown-evidence policy for missing IDs.
An unsaturated, catalog-aligned inventory can still establish absence.

Codex discovery supports both the legacy `Contents/Resources/codex` and the
`Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` layout in
Codex.app and ChatGPT.app, independently of the Service PATH. When a saved
bundled executable disappears, registration reconciliation may follow a verified
replacement inside that same host app. It preserves launch arguments and never
switches between host apps or from an app to a standalone CLI automatically.
An unsuccessful replacement probe retains the original selection and failure.
Other providers retain stable command entrypoints; Cursor additionally repairs
its historical version-directory selections. A sole alternative installation is
not evidence of the same identity and requires explicit owner selection.

ACI launch evidence may include the bounded `installation_missing` or
`installation_access_denied` reason. Cloud reporting preserves these reason
codes while stripping raw diagnostic text and local paths. Owner-facing clients
render actionable copy from the reason, independently of computer connectivity.

The selected launch contract remains the install and update identity. When an
Agent Controller is bundled inside a host application, ACI must treat that host
application as the update owner. It must not compare the bundled runtime with a
standalone CLI package's release channel or offer that CLI package's update
command. If the host application does not expose a stable update-status
contract, ACI omits the version advisory instead of guessing across sources.

OpenCode Wake execution validates the selected launch files and starts the real
controller task without a separate `--version` process. Version and capability
probes remain in discovery/Prepare; a slow version probe must not be turned into
an invalid execution contract. This does not bypass permission capability
attestation or the actual controller startup and execution errors.

Concurrent controller cleanup shares an unfinished macOS process-table read,
even after the short snapshot age has elapsed. Once the read settles, its
original capture time still determines freshness; the existing bounded cleanup
retry obtains a fresh snapshot. Sharing reads never shares process ownership or
the decision to signal a particular execution.

The same identity rule applies to standalone installs. Latest version and the
update command must come from the selected install's channel: that controller's
official native updater, npm/pnpm/bun, or the Homebrew formula actually
installed, including its tap. ACI must not compare a third-party tap install
with Homebrew core, and must not advertise a generic updater whose latest
source is a different package. Homebrew cask versions may append a comma and
numeric revision after the SemVer core, as in `0.143.0,45`. ACI compares that
core and keeps the full version string in the advisory.

Cursor native installs use that same channel, with one recovery for builds that
cannot run the updater. Builds before 2026.07.17 make `cursor-agent update`
exit with `[unauthenticated]` when the CLI is not signed in, and that exit
cannot install a newer build. Cursor's published recovery for that install is
the official installer. ACI reports `curl https://cursor.com/install -fsS | bash`
on macOS and Linux, and `irm 'https://cursor.com/install?win32=true' | iex` on
Windows, when the selected install is that native channel, the build is older
than 2026.07.17, and the CLI is not authenticated. Authenticated Cursor CLIs
report `cursor-agent update`. Builds from 2026.07.17 onward report
`cursor-agent update` because that updater reaches Cursor's public installer
without a signed-in CLI. The 2026.07.17 boundary is the first build date whose
logged-out updater is known to call that public installer: Cursor confirmed on
2026-07-19 that older logged-out builds, including 2026.01.28, cannot update
themselves, and build 2026.07.17-3e2a980 updates through
`https://cursor.com/install`. Homebrew Cursor installs continue to report the
Homebrew cask upgrade for the installed tap.

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
and honest states. The same report may carry one optional account-level
`usageAdmission` observation: `blocksNewWork` is true, false, or null, and
`observedAt` retains the provider observation time. It contains no balance or
account identity. Codex window exhaustion records included usage, not an
account-wide refusal when credits still permit new work. Its admission fact
uses the native account permission plus credits and spend-control evidence;
unrelated metered windows do not veto it. A full unknown account read records
null and cannot prove recovery. Sparse rolling notifications do not clear or
refresh an earlier account fact; explicit backend spend control may still block.
Codex collects a full snapshot on the same native session when an account-limit
notification arrives. One pending read coalesces further notifications. Native
auxiliary reads have finite per-request deadlines; expiry removes the pending
request and permits a later notification, without ending the business turn or
creating new recovery evidence. Late replies to expired requests are ignored.
Native
account ids must match before and after the account read, and the native
account-change epoch must remain unchanged through collection and consumption.
An unknown or mismatched subject discards capacity evidence. The existing local
ACI auth/keeper compares an opaque subject hash, including same-email workspace
changes; neither that hash nor the raw native id enters cloud reports or legacy
CLI JSON. No model-to-bucket mapping is guessed. A controller that hosts multiple model providers may also
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
is `unavailable`. Its optional bounded reason distinguishes a sign-in gap,
inapplicable account capability, omitted provider measurement, and a failed
refresh. Independently reported reset evidence may remain known without a
percentage. Grok's verified proto3 implicit float default is zero only for a
successful unified-billing response with a recognized active period; malformed,
non-unified, or expired responses never acquire guessed capacity.
A controller with no supported native source is explicitly
`unsupported`. The Service does not decide Agent Profile Wakeability, Binding,
Wake admission, RuntimeCoordinator, routing, or agent selection from these
states. Core applies the shared versioned capability matrix to the report it
already holds; it never calls the provider on the Wake hot path. The Service
stamps each current ACI report with `usageLimitsSupportMatrixVersion`; this
identifies the evidence contract Core may use to prove exhaustion. Missing or
unconfirmed Usage does not block an otherwise ready Agent. A legacy Service
report without that optional declaration remains
valid during mixed-version rollout and does not acquire a new Usage admission
condition solely from a newer Core matrix. When retrying against an older Core
contract, the Service omits the Usage windows, account admission, and support-matrix
declaration. For a
controller whose matrix entry declares native Usage support, Codex requires a
fresh explicit account admission verdict rather than a window percentage.
For other supported controllers, a reliable fresh
`available` observation proves current capacity and a reliable fresh explicitly
`exhausted` observation blocks the Wake as `Unavailable`. Missing, stale,
expired, unavailable, or otherwise unconfirmed Usage does not add a block;
the separate current Controller readiness and trust requirements still apply.
Positive fresh capacity remains required for automatic recovery after an
exhausted execution. A controller that explicitly reports Usage as
`unsupported`, or whose matrix entry is observational, unsupported, or not evaluated,
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
monthly windows. A Go 403 is an inapplicable account capability, not evidence
that the signed-in controller or its other providers are broken. OpenRouter's
official key endpoint supplies independent free-model daily request limits and,
when bounded, a key budget. Missing reset times remain unknown. OpenRouter
observations cannot block a paid model or authorize exhausted-work recovery.
Credentials come from the native provider inventory when exposed, otherwise
OpenCode's official local auth input or store, then the provider environment
key. Stored auth takes precedence over environment keys. Custom provider
endpoints do not send credentials to the default account endpoint. Keys are
used transiently and never logged, retained, or projected. Other providers are
`unsupported` until a provider-owned, non-task capacity source is verified.
Failure to read provider usage produces provider-scoped `unavailable`
evidence without failing the rest of the Computer inventory.

Inventory checks must not initiate interactive sign-in or request interactive
credential-store access. An explicit status refresh is still a read, not consent
to sign in. Known signed-out accounts skip quota collection; missing credentials
or an unreadable credential store must never become zero remaining capacity.
Only an explicit sign-in action may enter an interactive authorization flow.

Antigravity's `agy --print /usage` can enter authentication and open browser
login pages or request Keychain access. Until a provider-owned no-interaction
contract is verified, both fresh and background ACI checks for the legacy CLI
run only `--version`. The legacy CLI reports installed with unknown account
status, without an actionable warning for an unsupported check.

The separately selected official ACP installation uses `initialize` followed by
`session/new` to verify native account admission and obtain model config options.
It never sends a prompt or calls `authenticate` during inventory or Wake. Google
ACP 1.3.0 can itself attempt login from `session/new` when saved credentials are
missing or invalid. All ACP entry points therefore use native file credential
storage, a preflighted successful browser sink, and interception of the native
login output. A passive login attempt fails as unauthenticated and closes the
process; it cannot open a browser or request Keychain access. Network, timeout,
and protocol failures remain incomplete checks, not signed-out evidence.

Only `openmeld agents login antigravity` calls native `authenticate`. It displays
a validated Google loopback authorization URL for the user to open. Cancel and
the five-minute deadline close the process. Success requires session admission
and a second process using the saved native sign-in. No tokens or account cache
are copied into OpenMeld. Login, inventory and dispatch share the selected
installation and native `GEMINI_HOME` configuration; they do not create provider
instances. This file store may need its own explicit sign-in if the standalone
client uses the system credential store. On Windows the browser sink requires
Node on PATH and fails before server launch if its preflight cannot run.

Fresh checks bypass the usual keeper TTL; process restarts rebuild account
evidence from native session admission. A successful native session is local
ACI evidence, not final Wakeability or proof of available quota. Usage remains
`unsupported`; neither internal Google quota endpoints nor token-file parsing
are part of this integration. The legacy CLI execution transport remains available.
The shared Usage support matrix declares Antigravity unsupported so historical
quota cannot become new capacity authority or authorize automatic recovery.

A completed signed-out check is reusable for the same binary within the normal
one-minute background TTL. It clears account-bound passive usage, does not arm
failure retries, and expires normally. A fresh user check bypasses this cache
to discover an external sign-in immediately. Unknown authentication is not
proof of sign-out, and transient failed checks retain the existing failure
policy rather than becoming a permanent negative cache.

The Service schedules coalesced native inventory checks every minute, separately
from transport heartbeat. Explicit checks bypass reuse. This bounds normal
external sign-in/sign-out discovery without running a provider probe on each
Wake. Probe failures and disconnection can delay discovery; they do not prove
sign-out. Core accepts authentication evidence for at most two minutes of native
observation age. It subtracts the difference between native `checkedAt` and
publication `observedAtMs` (the same device clock) from its receipt-time budget.
The stored publication time remains a source-ordering field; the stored expiry
uses Core time. Republishing the same `checkedAt` cannot extend the stored expiry,
including concurrent writes. An expired report is not current readiness evidence.
Usage keeps its own original observation, account binding, and freshness policy.
Expired account evidence projects unknown authentication and a delayed check;
it must not display the old signed-in or signed-out observation as current.
Usage windows expire by their own observation and reset times, not merely because
the faster account report expired.

This policy requires Service 0.3.264 and the
`openmeld-service-contract-2026-10-auth-freshness-v1` carrier contract. The wire
payload and Runtime Transport epoch remain compatible. During receiver-first
deployment, Core keeps the published release manifest and the previous auth
lifetime. The shorter lifetime and monotonic Service floor activate together
only when the effective published Service manifest reaches 0.3.264. Old Services
then show a required update before new Wake admission; accepted work and rescue
commands remain available. A later optional release must retain that floor.

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

Claude Code uses the public Agent SDK control connection on verified CLI
versions (2.1.285 or newer), without sending a user message. The probe disables
hooks, tools, MCP connections, session persistence, and IDE connections, and
requests usage with `skipBehaviors: true` so collection never scans local
transcripts. Initialization must prove the same first-party account as native
ACI authentication before reading usage. SDK account windows are percentages;
ordinary `rate_limit_event` utilization is a fraction. Dynamic model windows
and independently known reset times are preserved; monetary and behavior fields
are discarded. Older versions remain observational with unreported capacity.
OpenMeld must not replace the user's status line, read Claude credentials, call
a private OAuth endpoint directly, or substitute transcript token/cost estimates.
This experimental source is observational and never decides Wake admission or
automatic recovery.

Cursor reads its native CLI login token transiently from the effective
environment, its official auth file, or the macOS Keychain with interaction
disabled. Explicit API keys and memory-only stores never borrow a saved account;
custom API endpoints never send tokens to the default account endpoint. The
DashboardService percentages include bonus usage and are displayed independently
of billing dollars. No browser cookies, IDE database fallback, refresh writes,
or payment information are used. This internal source is observational because
paid overage and account-specific limits cannot safely decide Wake admission.

Codex also publishes `account/rateLimits/updated` events through this same
account-bound keeper after native authentication proves the current account.
Neither event collection nor account queries start a conversation or model call.

### Agent Instruction Delivery

Within one dispatch preparation, Documents, Skills, and Space instructions share
one freshly resolved Agent identity and one authorized Space metadata response.
Document and Skill directories load concurrently after that scope is established.
Do not retain this context across Wakes or reuse it for later context-tool reads:
those reads must check current authorization and Skill enablement. Explicit
handoff Skill releases remain pinned. A failed directory read does not discard
the other directory or the authorized Space metadata.

The local dispatch journal records `bootstrap_read_completed` with the operation,
duration, and loaded/failed status. These measurements describe preparation only;
provider acceptance, useful first text, and final publication are separate
milestones. Timing records do not contain directory contents or credentials.

For a new Codex Session created by an ordinary Wake, Service derives an optional
bounded title from the Agent Profile name and the current Wake text, before
bootstrap instructions are rendered. After Codex accepts the first turn, its
adapter attempts native naming once on the existing connection without awaiting
the response, adding an execution-fatal timeout, or delaying connection cleanup.
Naming failure is diagnostic only. Resumed Sessions and temporary reply-repair
forks keep their native titles; there is no historical backfill, retry queue, or
parallel title store. A native title change remains provider-owned Session truth.

Runtime-independent Space identity, task-material trust, and current-Wake
participant rendering are consumed from `packages/space-mesh`, together with
its existing Entry Brief and continuity helpers. Local supplies CLI read
instructions and retains action submission, publication, injection epochs,
and provider adapters. Shared rendering grants no new tools or permissions.

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

Space Action submission rules are also stable instructions, conditional on the
current Wake requiring a reply or silence action. The permitted completion
action remains explicit in every Wake, including when both briefs are hidden.
Native instruction delivery omits repeated submission rules from that turn's
input; the complete fallback retains them. The content-derived epoch changes
when those rules change, so older or unproven conversations receive the complete
fallback. No history is summarized or removed and no native conversation is
replaced for this optimization.

The stable workflow applies only to OpenMeld Wakes. User messages, Space Guides,
attachments, and history remain task context rather than runtime instructions
or new permissions. Current completion guidance requires the permitted action
and inspection of its response, while preserving raw-reply, status, and silence
contracts. A successful action acknowledgement records a proposal; only Core
publication establishes a visible Space reply. Plain replies omit additional
targets. Suggested send-target lines exclude the acting Agent without changing
the complete member projection used for independent action validation.
When the harness offers tool discovery, completion guidance requires checking
for the Space Action tool before treating it as unavailable and using the CLI
alternative. Reply submission alone does not require onboarding material.
Unknown-submission guidance applies to Space Action submission outcomes, not
context reads or other business tools. When a context read fails before any
Space Action submission, the Agent should report the blocker through the
permitted completion action rather than invent results or silently finish.
Shared text attachments use the dispatch `read_file` tool when available.
Large local Space reads retain their complete in-memory result and expose
bounded pages. Agents may use `read_result.query` to locate literal text in that
original JSON without replaying every earlier page. Search excerpts remain
untrusted task data. They neither summarize nor replace history, and broader
questions still require additional searches or complete reads. Every search
revalidates source access and version through the same owner as paging; results
remain scoped to the active Wake and tool connection.
Dispatch MCP tool processes retain the carrier's `OPENMELD_HOME`,
`OPENMELD_AUTH_URL` and `OPENMELD_GATEWAY_URL` when present, alongside its
environment preset. The shared adapter configuration forwards these non-secret
environment selectors so filtered harness environments cannot silently resolve
a different lane's login state or endpoints. No credentials are embedded in
instructions or added to the tool environment by this projection.
Other context-reading commands use the existing dispatch-scoped absolute CLI entry
from `OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH`, so a provider's login shell
cannot redirect them to an unrelated installation through PATH. Human-facing
Service maintenance guidance keeps the normal lane command.

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
the exact shared adapter catalog of final actions, context readers, Task
operations, progress, and ordinary Direct Message collaboration. The CLI server
and `OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES` must agree; controllers still reject
missing or unexpected tools. Delivery-only recovery exposes exactly `reply`,
`stay_silent`, and `read_receipt`. Direct Messages retain the admitted Agent and
source organization checks; tool discovery does not authorize a different lane
or identity. File reads accept only a file ID and optional
revision; the active dispatch supplies the Space and acting Agent identity.
The trusted tool process invokes the dispatch-owned CLI's existing public file
read command outside the controller sandbox, preserving normal authentication,
Space permissions, revision checks, and text-size limits. It never grants the
controller access to local credentials or arbitrary filesystem paths. A file
read does not record an action or finish the Wake. The configuration forwards the active
dispatch identity, and fails closed when the action context is absent, expired,
or mismatched. Fresh and resumed controller conversations use the same tool
boundary. Codex, Claude Code, Cursor, Grok Build, OpenCode, Antigravity ACP, and OpenClaw use
their controller-native tool extension point and the same
dispatch-owned action writer. Controllers without a proven structured-tool
surface continue to use the exact dispatch-scoped CLI fallback.

Codex native-tool admission reads MCP tools and authentication status when it
only needs to exclude an alternate OpenMeld carrier. Unrelated resource discovery
must not block that turn. Scoped MCP carriers still request the full inventory
and verify tools, resources and resource templates, including delivery-only
recovery. Narrowing ordinary inventory does not weaken the scoped isolation
contract or increase initialization timeouts.

Antigravity's legacy CLI does not currently expose a proven per-invocation structured-
tool configuration surface. During an action-enabled dispatch, the adapter
therefore appends the dispatch publication contract to the invocation prompt,
asking for one `reply`, `status`, or `silent` outcome through
Antigravity's native JSON-schema output. The adapter validates that structured
result and invokes the same dispatch-owned action writer directly without a
shell. It grants the model no additional tool permission; all shell, file,
network, and ambient MCP actions continue through Antigravity's normal
permission policy. Publication requires no Skill read. Additional user-requested
OpenMeld operations still use the official Skill under normal permissions.
The prompt identifies the same working folder used to launch the CLI. The
adapter must not add an auxiliary workspace for instruction delivery: an
Antigravity conversation can retain that directory and resolve later file
tasks there. It never writes Antigravity's user settings or the user's project
customization files.

Antigravity's Binding permission intent is passed to every new or resumed CLI
invocation using its native mode/approval flags. This changes no Space action
authorization and grants nothing beyond the owner's explicitly selected mode.
The four `antigravity:*` permission values require an updated CLI/Service;
older strict schemas reject those values. Both the CLI command contract and
Service runtime epoch advance; the formal local-component release must mark
both components required. Keep version stamps in that release PR.

Use the existing receiver-first Core deployment when this change ships with a
Service-to-Core addition such as workspace-recovery decline. Its immutable
published-manifest override preserves the previous image-geometry epoch for
old Services while also accepting the new Antigravity epoch. During this stage,
Core rejects all new `antigravity:*` permission writes at Binding, creation
request, and remembered-default boundaries. An omitted mode remains unchanged.
Readiness diagnostics report the same effective epoch as runtime admission.
After the new CLI/Service artifacts exist, the normal final Core projection
enables those writers and requires the new epoch for new Wake work. Old Core
does not accept the new Service epoch: the receiver deployment must precede
Service publication. Never infer safety merely from the delayed version floor.
Already accepted work keeps its existing lifecycle; unknown permission values
must never silently fall back to another mode.

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
provider-conversation proof must use `thread/read` with `includeTurns: false`,
never `thread/resume`. Reading proves that the exact stored conversation is
available; it does not prove execution admission or initialize tools/MCP. A
missing or unreadable thread fails the check without falling back to resume.
Proof reporting uses `codex_app_server_thread_read`; Core accepts legacy resume
receipts during rollout and selects the newest unexpired receipt for the exact
Binding, runtime, controller, and conversation. Checks must not set approval,
sandbox, model, collaboration-mode, or other turn policy on the canonical
controller conversation. Public readiness responses expose the read method only
with the explicit version-2 opt-in defined in `shared-contracts.md`; legacy
responses leave the method unspecified (`null`) without hiding the check's
status or diagnostic evidence. Local Service diagnostics retain the exact
method. Codex's official cross-process thread
writer lock makes `thread/resume` the atomic occupancy admission boundary. The
exact App Server `-32600` response `thread <id> already has an active writer`
for that resume is structured Agent Controller conversation occupancy, not a
Wake failure. OpenMeld keeps the task at the Profile FIFO head, observes the
official lock release, and retries that same metadata-only resume immediately.
A low-frequency recovery retry (30 seconds) asks official admission again even
when the lock file still exists: an abrupt writer exit releases the OS lock but
can leave that file behind. This retry is not release evidence and does not clear
the occupied projection. Only the provider may acquire or clean its own lock.
Normal release events still retry immediately. This adds at most one admission
attempt per recovery interval for an occupied FIFO head and no polling to normal
execution. If the exact lock is unexpectedly not visible after Codex reports
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

The Codex adapter exposes optional, text-only exact-task steering through the
active App Server session's native `turn/steer` method. It uses that session's
accepted `threadId` and `expectedTurnId`; it must not resume a different thread,
start a new turn, retarget a newer turn, or change execution policy. Stop and
settled tasks reject further input. The caller's stable `inputId` is forwarded
as `clientUserMessageId` for correlation, not as an idempotency guarantee.
A matching native receipt means the input was admitted to that turn, not that
the model finished acting on it. Native
method/precondition rejection proves non-application; an internal error,
missing acknowledgement, or mismatched receipt does not. A steering receipt
timeout leaves the original execution running and never retries the input.
Unconfirmed receipts retain a bounded diagnostic code and the native numeric
error code when present, without forwarding provider error text as product copy.
The native contract is documented in the
[Codex App Server reference](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn).

Claude Code uses the same exact-execution receiver with the Agent SDK's open
user-message stream and native `priority: "now"`. It never opens a second query
or resumes another session to deliver input. This requires Claude Code 2.1.290
or later: older versions can acknowledge a duplicate UUID before consumption.
The installed executable, not the SDK dependency version, determines eligibility.
A matching top-level replay message from the active session confirms consumption;
writing to the input stream alone does not. The receipt's `threadId` is the native
session ID and `turnId` is the consumed native user-message UUID. Claude does not
provide Codex's atomic `expectedTurnId` precondition; priority delivery follows
Claude's current execution boundary. The UI promises immediate delivery to the
working Agent, not identical provider turn semantics. Repair and delivery-only
queries reject live input. A priority message can yield the old native turn's
result before its own replay and continuation. That intermediate result must not
settle the OpenMeld task; wait for consumption and the continuation's result.
The replay can follow the continuation's start by more than ten seconds of
thinking, so a submission has no fixed receipt timeout. Only a continuation that
does not start within ten seconds of the yielded result closes input.
Stop, the final native result, and query cleanup close input
and settle unacknowledged submissions as unconfirmed. When the Space's apply wait
ends first, the Execution Host reports the receipt as pending
(`service.execution_input.pending`) and Space keeps reading it until it settles.
A receipt timeout does not stop the original execution or authorize a resend.
Space retains the durable queue and the Execution Host retains the existing
deduplication responsibility.

The Execution Host's private inherited IPC `executionInput` method accepts an
exact owner account, Profile, dispatch, attempt and RuntimeCoordinator execution
and run. The registry receives these identifiers from the existing admitted
delivery, never from a new input; a replacement attempt cannot inherit old input.
The current connector generation and Profile lease must match; draining admission
rejects new application. Only the existing inflight registry resolves a local
task. The frozen source retains Space, Signal, author, original requester and
the `steer` effect; it is correlation, not a grant from the Agent's owner.
The Host joins concurrent identical inputs and retains bounded receipts across
socket replacement, including uncertain native outcomes. It never starts a
turn or cancels the task. A receipt query cannot resend. A missing receipt after
Host replacement or retired-execution receipt eviction is unknown, not proof
of non-application; Space must keep that input held.

The Service advertises this receiver through the optional
`x-openmeld-local-execution-input: 1` handshake header, never a new field in old
strict registration payloads. Core authorizes the original requester and effect
in the Space queue owner, resolves the exact active attempt/run in the existing
Coordinator, and sends apply/read over that execution's current socket and
Profile lease. The connector forwards to this private receiver; it does not
select an execution or grant authority. A read after Host replacement can only
return missing evidence, never permission to apply again. RuntimeCoordinator
execution and Stop ownership are unchanged; the adapter and receipt cache do
not own a second execution or pending-message state machine. The private IPC
extension ships with its matching connector/Host bundle. Installed-candidate
and real Local model acceptance are separate from protocol fixtures; no old
published bundle is certified by deferred feature checks. There is no new public
Service command or general Local Agent tool in this slice.

Space may persist a queued draft before Coordinator admission by validating the
original Human author against its durable dispatch source. This draft names the
dispatch and Agent owner but contains no attempt/run authority. Send now resolves
the current binding before claiming that same input row. Receipt reads require
the saved binding; they never resolve a new run or resend. Ordinary queue
consumption still waits for the predecessor's successful final Space reply.

After an occupancy transition, the Service includes the current occupancy value
on the first keepalive in its current lifecycle phase, the first keepalive after
a connection-generation change, and a low-frequency recovery keepalive while
occupied. Available is a transition, not a timer-generated admission heartbeat. Until
`turn/start` returns the accepted turn, the Service remains `accepted_local`;
App Server process spawn, protocol stdout, and writer occupancy do not promote
RuntimeCoordinator to `running`. Ordinary keepalives between those frames omit
the additive field so an older Core can still observe fresh local ownership.
Current Core may recover a lost transition after a WebSocket reconnect or
Service restart without polling Codex or delaying normal Wake admission.
Once Core knows the conversation is occupied, repeated same-phase keepalives
only confirm liveness and do not extend the progress deadline. Availability or
provider-accepted advancement to `running` restores normal progress tracking;
the Coordinator's admission record remains the occupancy authority.
Every registration on one socket reports its original `socketConnectedAtMs`.
Core also preserves the first connection time on same-socket re-registration,
so older Services that report the registration time cannot manufacture a
reconnect. A genuinely new socket retains the existing communication-recovery
semantics, including after Core restores persisted state.

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

Control-operation deadlines are risk-specific. Configuration and managed
requirements reads, history reads, and collaboration-mode lookup keep a short
bound. Thread creation/resume and `turn/start` acknowledgement use the bounded
90-second cold admission window. Plugin, skill, MCP, and workspace initialization
can be delayed by temporary host pressure. Only the initial controller handshake
can be retried before thread admission. An unacknowledged thread creation or
resume fails closed rather than creating another thread.
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
attempt to inspect every tool call or reimplement Codex filesystem policy.
Selected-folder profiles retain Codex's `:minimal` read baseline for system
executables and libraries; denying the filesystem root must not prevent native
commands from starting. Other user files remain outside the selected roots.
The Agent receives one path-free awareness instruction so it understands that the
run is intentionally bounded, but prompt text is guidance and never proof of
enforcement.

Codex boundary probes, CLI launches, and App Server thread/turn requests use
`on-request` with an explicit `user` approval reviewer for Ask for approval.
Approve for me alone selects `auto_review`. This aligns the boundary probe with
the existing native App Server policy; it does not promise a prompt for every
operation already allowed by the native sandbox. Explicit `untrusted` is no
longer accepted by current Codex versions. Repair remains read-only with human
approval, and isolated Execution Contexts retain their separate no-escalation
`never` policy. No fallback to Full access or boundary bypass is permitted when
an executable rejects these arguments.
A completed negative boundary launch check retains the path-free
`computer.file_access.launch_rejected` diagnosis. The owner decision explains
that the selected Agent's version/configuration needs checking, rather than
mistaking a launch rejection for missing consent. Unknown checks keep generic
verification guidance; raw controller diagnostics and folder paths stay private.

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
must not be written to PostgreSQL, Organization data, Agent Activity, cloud snapshots,
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

Cursor, Grok Build, and Antigravity ACP share adapter-core ACP process mechanics: newline JSON-RPC
framing, pending-request ownership, lifecycle telemetry, bounded admission,
session cancellation, and process-tree supervision. Their adapters retain
vendor-specific launch, authentication, model, mode, extension-request, and
error semantics. Stop is terminal only after the adapter cancels the live ACP
session, closes it when supported, and the supervised controller process and
descendants are reaped; a successful protocol cancellation alone is not final.

ACP transport support alone does not declare Execution Context support. Context
concurrency, completed-history forks, exclusive tool access, and project-file
confinement require verified adapter capabilities; they must not be enabled by a
generic ACP flag.

Codex App Server maps current and legacy command/file approvals,
`requestUserInput`, additional-permission approval, and MCP form or URL
elicitation into the same contract. Claude Agent SDK maps `canUseTool`,
`AskUserQuestion`, `ExitPlanMode`, and MCP elicitation. OpenCode uses its local
server event stream plus official permission and question reply endpoints.
OpenCode 1 uses `@opencode-ai/sdk/v2`; OpenCode 2 uses `@opencode/client` and
its native `/api` routes. Server startup identifies the API generation without
an extra version process during ordinary Wake. OpenCode 2 confirms the submitted
inbox receipt, execution outcome, and current-turn assistant messages separately;
an HTTP prompt response or completed wait alone is not a successful execution.
Its native forms and permission decisions reuse the existing human-interaction
contract. An already active resumed session is rejected before policy mutation.
The dispatch MCP server is registered in the owned server's in-memory registry,
with direct tools and unchanged permission rules. No user configuration is
written. OpenCode 2.0.24 reports MCP connection before its 100 ms debounced tool
reload; startup allows 500 ms for that reload because the API has no public
tool-registry-ready receipt. Real-binary smoke must verify tool execution, not
only an MCP connection or a text answer.

Execution admission is independent of conversation occupancy. Codex and
OpenCode declare `executionAdmission: provider_turn_accepted`; the Service
remains `accepted_local` until that event. It does not periodically repeat
unoccupied `accepted_local` as if local ownership proved provider progress.
Occupied-wait recovery and admitted-running keepalives retain their separate
contracts. RuntimeCoordinator remains the only in-flight execution authority.

OpenCode 1 uses a caller-selected, native-format message ID. HTTP 204 and a
registered user message are not execution admission. The first root-session
assistant message whose `parentID` matches that exact input emits the existing
`provider_turn_accepted` event. Unrelated messages and historical idle events
cannot admit this turn. Native completion does not wait for a lost HTTP
acknowledgement. An uncertain submission is never automatically resent:
OpenCode 1.18.34 appends parts when an input ID is reused, rather than providing
idempotent execution. A broken non-replayable event stream fails visibly instead
of reconnecting indefinitely while the Service keeps reporting running.
OpenCode 2 admission requires the matching inbox delivery and execution-started
event; its HTTP inbox receipt alone is insufficient.

Antigravity ACP uses the official `agy_acp_server.par` or `agy_acp_server.exe`
installation and its adjacent `localharness_external` executable. It remains
a separate selectable installation from the legacy `agy` CLI. Explicit execution
uses the account selected by explicit `agents login`, with browser launch
disabled and bounded session admission. Wake never calls `authenticate`. Missing credentials produce a sign-in error.
The adapter uses native `session/new`, `session/resume`, model configuration,
advertised modes, dispatch MCP servers, and `session/cancel`. Native choice
questions and permission requests reuse the current interaction UI; security
warnings remain visible, and native "always" approval means this session.
Unsupported modes, reasoning settings, and choices fail explicitly. Installation
does not imply authenticated model access; background inventory never authenticates.

Antigravity advertises Execution Context v5 and native permission inheritance.
Core admits new/continued tasks only with `permissionSource: agent_settings`;
explicit access restrictions and history forks fail before dispatch. The adapter
also requires official ACP and verifies this scope at execution. Managed
workspaces, writer admission, context-scoped ledgers, and completion identity
reuse the Service context owners. Missing native history cannot be rebuilt for
an assigned context. Old Services lack the permission-inheritance declaration
and receive the existing update-required outcome.

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

Install launch verification follows the same rule on every install path:
first-use resolution, a persisted launch contract, and explicit repair. A
failed launch check is retried once immediately. Only a completed negative
result after that retry reports `needs_repair`; a check that still could not
finish, including a probe timeout, keeps the install usable.

An installed or detected controller that cannot currently launch must remain
visible with explicit repair evidence; it must not be relabeled as missing or
silently removed from local-agent selection and diagnostics.

Provider process startup and provider task execution are separate lifecycle
phases. An adapter may bound and retry a protocol initialization handshake only
while it can prove that no provider thread or turn request began. Once provider
initialization succeeds, ordinary long-running work remains governed by fresh
execution progress, explicit cancellation, and terminal results rather than a
fixed wall-clock deadline.

OpenCode server initialization gives each process the same bounded 15-second
listener budget. A slow first process must not be killed at an earlier
five-second threshold merely to repeat initialization. One replacement remains
allowed before any provider session or turn command, after confirmed process
exit, within an explicitly configured task budget when present. Health checks
remain bounded separately. Timeout diagnostics preserve the phase, attempt and
safe retained startup stderr without reclassifying informational log text as
an authentication failure. They do not claim that a provider task began.

Each failed OpenCode initialization retains bounded evidence for both attempts:
process identity and timestamps, elapsed listener budget, output byte/line
counts, whether the validated ready line arrived, and the host load average.
After five seconds of unresolved startup, one asynchronous 250-ms loopback TCP
probe distinguishes an unopened port from an absent listener announcement.
It sends no HTTP/provider request, never authorizes execution, and never extends
the startup deadline. Fast starts perform no extra probe. Startup completion or
cleanup cancels the probe. Local slow/failure logs correlate with the existing
dispatch process events by PID and spawn timestamp; final errors retain the
same evidence through the existing safe original-error field. No environment
values, prompts, credentials, raw stdout, or working-directory paths are logged.
These observations do not establish why an external process failed to start.

The separate OpenCode discovery/Prepare server probe retains its own bounded
startup deadline. A timeout includes the child PID, actual elapsed time, output
byte counts, and host load, plus startup output only when it passes the shared
bounded original-error safety policy. These are diagnostic facts, not evidence
of invalid credentials or a started Wake. Provider-status read timeouts remain
distinct from server-start timeouts.

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
controller-provided skill inventory, or free-text local
diagnostic message. It may send the optional provider email or bounded account
label only for the authenticated owner's local-runtime inventory so that the
owner can distinguish which account OpenMeld will use. Core receives only the
bounded authentication type for account-scoped model admission, controller
identity, enabled/readiness status, static native
capabilities, native interface, version evidence, bounded check status and
last-success timestamp, optional owner-facing account identifier, and other
fields explicitly required by a current owner-facing product surface. This
account evidence and authentication type must not enter Organization computer directories, Center Agent
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

## Execution Context Isolation

An Execution Context is a Core-assigned work identity, separate from the Agent
Profile, Binding, native conversation, and Service process. Scoped deliveries
use a context-specific local lane and ledger key. The Service must not search
the Profile's other contexts as a fallback or heal a missing scoped conversation
by silently starting another one. Ledger v2 reads valid v1 state without resetting
its native conversation mappings. Corrupt scoped evidence fails closed.

New Codex and Claude contexts with `permissionSource: agent_settings` use the
ordinary native tool, settings, hooks, MCP, and permission-mode path. The starting
Project folder does not create a filesystem boundary. Computer File Access still
applies when configured. Only explicit or retained bounded Claude project tasks
prepare a container and replace native shell tools; creating a new conversation
alone must not do either. Delivery-only correction retains its narrow purpose.

For an inherited-permission independent copy, source preparation and launch both
check the current Computer policy. An `only_selected_folders` policy is projected
for that run by retaining every configured root and adding only the verified
copy's exact root, including its private Git metadata. The projection is never
saved as Computer policy and never adds the parent OpenMeld directory. A newly
denied source still fails. Blocked-folder policies remain unchanged, and native
boundary verification and owner-only unsupported-boundary decisions still apply.
Working-copy placement alone never invokes the bounded Claude project shell.

The existing local slot owner enforces the five-context Profile cap and local
resource exclusions. Isolated task folders have distinct canonical roots and
must not be symlinks. Each delivered Wake claims the folder it touches when it
is enqueued: Space-only work and isolated copies claim only their own
Service-owned root and never conflict with other work. A current-folder Wake
claims the shared roots of the canonical effective working folder from the
current route: the Git checkout that contains it, found from the nearest
`.git` as Git finds it, or the folder itself outside any checkout. A linked
worktree or separated Git directory also claims the repository's common Git
directory, because linked worktrees share its refs, stash, and configuration
with each other and with the main checkout. A writer excludes every reader and
writer with a root that is the same, an ancestor, or a descendant, and readers
of one root run together. Sibling folders of one checkout therefore take
turns, while independent repositories and plain folders run together. Git
metadata that cannot be read, a selected Project folder that is resolved only
during preparation, or an unknown folder overlaps every user folder. An OpenCode
continuation that may move to its conversation's earlier folder after the
owner's working-folder choice claims an unknown folder, because that folder is
decided only after the task is admitted. Pre-Context Wakes claim their Binding folder but
never conflict with each other, because their lanes already serialize each
Profile. An older waiting task keeps precedence over younger work whose claim
overlaps it, so a writer is not bypassed indefinitely. These claims coordinate
OpenMeld-launched work; they are not a filesystem sandbox, and an Agent whose
native permissions allow writes elsewhere is not confined by them. The local
wait reason `workspace_conflict` names a folder wait. These local checks
implement Core's reservation, rather than creating another durable admission
queue.
The slot and scoped Core reservation stay occupied until native execution has
settled, even when a Space Action proposal was saved earlier. Workspace deletion
requires stronger, explicit process-tree quiescence evidence; a provider result
or an expired shutdown grace period is not that evidence.

Version-2 project workspace records distinguish preparation, native use,
retirement, retained idle state, and released reproducible copies. Readers keep
valid version-1 records, and records without a verified original baseline are
retained. Preparation retries use the existing
process-identity lock and the recorded source/base commit. They never choose a
new source HEAD or overwrite ambiguous local changes. The Service may reclaim a
generated checkout and its private repository only after quiescence and an
unchanged content/metadata baseline are both verified. The exact retirement
intent is persisted before moving the copy, and the fenced copy is checked
again before deletion. Crash recovery uses that recorded path and preserves
edits instead of adopting arbitrary sibling directories. Task edits, ignored or
untracked files, new commits, and unknown ownership retain the workspace. An
uncertain in-use record blocks another writer until ownership is reconciled.
Continuation restores an eligible released copy at the same path and frozen
commit; an unavailable source commit has an explicit failure. Native transcripts
and task-created output are outside automatic deletion.

An experimental version-1 record left in preparation has no durable process
ownership evidence. It is retained with an explicit quiescence-unconfirmed
failure; the Service does not invent safe deletion or silently recreate it.
New version-2 preparations persist supervision identity before Git work so
interruption and restart can be reconciled safely.

Before replacing a valid v1 local ledger, the Service preserves and verifies a
separate prior-version checkpoint. Copy, file flush, exact readback, and atomic
rename must succeed before migration can replace the original; failure keeps
the original or its verified checkpoint available. The checkpoint is distinct
from an invalid-state recovery backup and must not be overwritten by it. Native
conversation IDs and lookup keys are preserved. Windows file handles use write
access for flushing; directory-entry durability across power loss is not claimed
on Windows. Native Windows execution remains a separate validation gap.

Explicit isolated project tasks use the already confirmed Project connection or
Profile working folder as their source. The source must be the exact canonical
Git root and must satisfy the current Computer file policy before Git inspection
or copying. The Service creates a private bare repository and a Git worktree
under the context root using a local fetch of the frozen committed HEAD; it does
not register a linked worktree in the user's source repository. Git hooks,
ambient Git configuration, filters, lazy fetching, and non-file protocols are
disabled during preparation. No dirty or ignored source files are copied.
The resulting task boundary includes only that context's worktree and Git data.
The workspace owner publishes the actual private Git config, hooks, worktree
config, `.git` pointer, `commondir`, and `gitdir` paths as shared
`ExecutionContextGitMetadata` facts. The native Codex boundary makes hooks and
routing pointers read-only, including replacement and creation, even under
`repository.git`, which native `.git` protection does not cover. Common and
worktree config remain writable so normal branch, remote, user and submodule
operations work. Service-owned Git inspection/preparation disables hooks,
fsmonitor, credential commands and non-file transports independently of task
Git; user task Git retains its normal credentials. Before native use, the
workspace owner saves executable config settings in its protected lane. After
native-process quiescence it restores new/changed executable settings, retaining
ordinary settings. Hook-path changes are preserved and reported through public
task progress: committed repository installers are identified where possible;
unverified installers require user review. No command values are published.
The audit is at dispatch completion, not between provider turns in a still-active
process, and it is not proof that task-authored code or an unverified hook is safe.
Objects, refs, logs, index and ordinary worktree data remain writable.
An out-of-boundary metadata path fails closed
instead of granting extra read access. Retained private repositories reject
symlinks and multiply linked metadata files before use; direct native protection
must not be generalized to arbitrary pre-existing aliases in current-folder
tasks. Other controller boundaries are not certified by Codex sandbox evidence.
`objects/info/alternates` remains a known native-boundary limitation: preparation
and reuse reject it, but this protection does not certify task-time object routing.
Its protected preparation record is outside the task's writable root and binds
the context identity, source path, starting commit, owned paths, and completion.
Retry verifies and reuses completed preparation. Incomplete or mismatched records
are retained and rejected rather than rebuilding over possible task effects.

Space-context-only tasks use a Service-owned scratch directory, not a user
project source. A Computer policy that allows only selected project folders
does not require adding the Service directory to that allowlist. Native access
remains limited to the assigned scratch root. Codex treats that root as its
project boundary using `project_root_markers=[]`, so project instruction
discovery cannot walk into an unrelated parent repository. This does not disable
global user instructions or change project discovery for local project tasks.
The dispatch-owned `read_history` MCP tool provides the existing bounded text
window without requiring a sandboxed shell to load Node, CLI code, or local
authentication files. Its Space, source Wake, and acting Profile are fixed by
the active dispatch, and it rechecks that context after the authorized read.
This read does not complete or publish the Wake.

An implicit ordinary Codex Wake uses `workspace` access with the `current`
workspace. The Service resolves that current workspace through the same
effective Profile working-folder path used by legacy dispatch; it must not
substitute the Service-owned Space-context scratch directory. Explicit
Space-only and isolated-project selections retain their separate boundaries.

A selected-file handoff is the narrow writable exception: after preparation,
the Service adds the dispatch's `workingCopyId` to the adapter boundary and
limits its folders to the prepared handoff root, not its parent scratch root.
Codex must confirm workspace-write access and pass the same real inside/outside
probe. Ordinary Space-only tasks remain read-only, repair remains read-only,
and the context still starts a separate native session. Copy receipts and
upload snapshots remain outside the writable root. This projection changes
neither Core authorization nor RuntimeCoordinator execution ownership.

Managed-copy reads and file creation require macOS `O_NOFOLLOW_ANY`, which
rejects symlinks in every path component during the kernel open itself. Leaf-only
`O_NOFOLLOW` and preflight directory checks are insufficient against a concurrent
intermediate-directory replacement. Other platforms reject managed-copy commands
until they have an equivalent verified primitive; explicit file commands remain
available. This is a Service file-read boundary, not evidence of a production
Codex sandbox escape.

Claude SDK Space-context invocations expose only dispatch-owned Space tools;
built-in local tools, ambient MCP servers, and hooks are disabled. User settings
remain available for the existing provider authentication. Codex local contexts
use a named native permission profile, an explicit runtime workspace root, and
`never` approval escalation. The Service checks the effective profile, working
directory, and sandbox returned by native thread start/resume before starting a
turn. A version string alone is not proof of enforcement. A native command also
checks actual allowed task-file access and denied outside reads/writes using
Service-owned sentinels. Failure rejects before a model turn. Platform temporary
directories remain governed by the native runtime; project and Git isolation
does not claim complete temporary-directory isolation. Paths covered by a broad
native temporary grant fail the outside-access probe.

Scoped Codex invocations enumerate the selected installation's effective MCP
configuration and disable each ambient server using one merged native table.
An empty table does not clear native configuration. A configured server using
the reserved dispatch name rejects rather than retaining ambient environment or
transport settings. Plugins, hooks, apps, and computer/browser controls are
disabled; the dispatch-owned Space MCP server is supplied separately. Before a
turn, the full effective MCP inventory must contain only its exact Space tools
and explicitly disabled empty ambient entries. Partial or unverified inventories
reject. Unsupported native permission evidence also rejects before execution.

Forks copy only an accepted completed native-history prefix. Claude uses the
SDK's `upToMessageId`; Codex uses `lastTurnId`. The existing local fork operation
journal retains the exact source/cutoff and child identity across retries,
including an unknown outcome. It must not issue a second native fork after an
ambiguous response. Native-history inheritance copies no leases, approvals, or
parent action credentials. An explicitly selected project worktree independently
materializes committed project content as described above; it does not copy the
parent's dirty working files or implicitly synchronize parent and child. A
completion without a verified native checkpoint may
preserve conversation identity but cannot authorize a fork.
Codex fork preparation reads the target's effective MCP configuration before
suppressing a native-tool source's alternate Space carrier. It disables an
existing reserved server without replacing its transport; when absent, it must
not create a disabled-only server table. Preparation receives no dispatch action
credentials. Malformed or unreadable effective configuration rejects the fork.
The Service observes completed turns across the initial invocation, reply repair,
and reconsideration. Each invocation clears the previous completion evidence;
each submitted proposal carries its own final verified turn. A missing final
turn event cannot fall back to an earlier turn's checkpoint.
Scoped Codex repair and reconsideration resume that Context's existing native
conversation with read-only project permissions. Native file probes and thread
attestation verify this same effective permission mode. A temporary repair fork
must not replace or diverge from the scoped conversation's accepted history;
legacy unscoped repair retains its existing behavior.
Native history is located by its authorized session ID, independently of the
task's current file workspace; a fork can retain history under its origin folder.

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

A local credential-store failure or expiry preflight does not prove a server
rejected the carrier's credential and must not close that connection. Reporting
preserves the typed local failure reason and may refresh expired credentials
through the auth-session owner. Authentication recovery requires an actual
rejection of the exact credential attached to the current socket; its ephemeral
correlation fingerprint must never enter logs or uploaded diagnostics.

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

A saved public reply does not complete the native controller turn. The Service
relays its text through the existing Space stream while the controller runs.
Both legacy and execution-context paths wait for the native result before
settling the local ledger and selecting the latest complete public revision.
An exception follows the existing failure path; a saved draft is not evidence
of successful execution. Private controller output cannot revise the public
reply. RuntimeCoordinator and Space retain finalization and terminal fencing.

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
heartbeat registration or socket reconnect in request order. Core treats an
exact replay as idempotent and re-announces it to open Spaces only when it
arrives on a new connection, so the heartbeat replay is cheap recovery, not a
Space refresh signal. Responded requests
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
while Windows records the native Job supervisor as the direct signal target.
The POSIX adapter retains discovered process IDs through graceful-to-force escalation and uses the supervision
identity after process exit, so reparenting cannot hide unfinished provider
work. Descendant discovery is auxiliary to signaling the known process group
and already recorded descendants: a discovery failure must emit a structured
diagnostic after those signal attempts and must never crash the OpenMeld
Service or suppress the primary Stop. A wrapper or controller exit therefore
cannot silently orphan a detached supervised descendant or keep a local
execution slot occupied after an accepted Stop.

On Windows 10 and newer, the shared process boundary launches each Agent
Controller inside a native kill-on-close Job using atomic process-creation Job
assignment. It does not create an unowned process and attach it afterward.
Only the selected invocation's supervisor owns the Job handle; standard streams
are inherited explicitly, and the Job handle is not. Normal controller exit,
supervisor termination, or loss of the original caller's process handle ends
owned descendants. Cleanup waits for the supervisor to exit and verifies an
empty or destroyed Job before reporting success. A bounded cleanup wait may
fail visibly; it is never a deadline on a healthy running Wake.

This is process lifetime supervision, not a filesystem sandbox or authority to
kill arbitrary same-name processes. Provider permission enforcement remains
separate. Work delegated through external brokers such as WMI or a remote
machine is not claimed to be a normal descendant of this Job. Native provider
sandbox/nested-Job compatibility requires Windows acceptance. The fixed helper
is a prebuilt Native AOT executable over the same reviewed Win32 API bridge;
it also reads process creation FILETIME through an opened process handle.
Windows builds compile it with the pinned SDK before packaging. Consumers do
not install .NET or compile C# during Agent launch or cleanup. Node/npm reads
the package's `dist/windows/openmeld-windows-process.exe`; this Service-owned
asset is copied into the npm Service bundle and included in its content hash.
All npm publishing platforms must use the same prebuilt Windows asset. A compiled carrier
requires that executable alongside the CLI/Service in the same version bundle.
There is no runtime PowerShell fallback for missing helper artifacts. The
Task Scheduler task-host migration is a separate lifecycle boundary below;
this change does not retire it or establish its timeout's cause. Denial by enterprise
policy is a visible launch failure, never permission to fall back uncontained.

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
  durable. A Web setup journal includes its non-secret Prepare continuation;
  after its exact owner process exits, the OS maintenance worker may adopt that
  same journal and resume the same Core Prepare session using a freshly minted
  owner-authenticated token. Ordinary auth reads preserve the committed account
  and must not roll back this continuation. A failed or cancelled continuation
  uses the existing previous-account recovery. Older journals without this
  intent retain their rollback-on-read behavior. Older auth readers can mark a dead Terminal for
  recovery while preserving its continuation field; the new worker may still
  resume that intent, subject to the same Core Prepare outcome. Current explicit
  cancellation and abandonment clear the continuation before account recovery.
  A committed transition is never recovered backward. A cross-account switch requires explicit
  confirmation in Terminal or the native Desktop dialog, bound to the stable identity of the exact committed
  session the user reviewed. The transition lock compares that identity before
  accepting the candidate; if it changed, setup requires fresh review. Before
  commit, ordinary CLI processes keep using the previous committed session and
  only the transition owner plus its candidate OpenMeld Service may read the
  candidate. OpenMeld Service uses the committed Computer session when it starts
  at login. The handoff must not be used to add an
  agent-selection step to Web.
  Replacing a known Service owner with a different known owner ends the old
  owner's service using the existing `user_stop` cause, including the legacy
  system-service stop path. Same-owner maintenance retains
  `controlled_service_update`. The lifecycle chooses that cause once and keeps
  it through the local stop journal consumed by the carrier.
  Desktop uses `computer connection-review --json` and
  `setup --connection-intent <json>` for that same boundary. The intent contains
  the expected new account and a non-secret hash of the reviewed old session;
  it is accepted only with a Prepare token and Device Authorization grant.
  Unknown or changed identity fails before a transition. This adds neither a
  second session writer nor a second lifecycle owner.
  A missing or unreadable old bearer token does not veto a freshly authorized
  handoff when the committed account metadata is intact. Metadata is used only
  for account-switch consent, the locked identity comparison, and naming the
  account a recovery restores, never to authorize execution. Rollback preserves the original payload, but does not
  restart a Service with an unreadable credential. Recovery must not reread an
  already revoked candidate token merely to finish local cleanup.
  Recovery restores the previous owner's Service only from that owner's usable
  sign-in. It names that owner from the restored payload metadata, not by
  reading its credential, so a temporarily unreadable secret store (for
  example, a locked Keychain) cannot erase the restore point. A previous
  payload that names no owner, including an incomplete first connection,
  finishes with the Service stopped. An unreadable previous credential records
  a retryable failure and keeps the journal; a missing one is an unusable
  sign-in. Recovery first validates the restored sign-in with the server, which may
  refresh a stale local expiry. While the journal is `recovery_required`, the
  auth-session owner persists that renewal of the same restored sign-in and
  moves the journal's restore point with it, because the Service reads only the
  committed local session at startup. When the server reports it expired, revoked, or
  invalid, or the committed sign-in belongs to another account, recovery leaves
  the Service stopped, keeps the previous committed sign-in metadata, revokes
  the candidate, and clears the journal. No account inherits a running Service,
  and an explicit sign-in or a new setup can then replace the sign-in. An
  unreachable server keeps the restore attempt and its retryable failure. The
  Auth Worker's sign-out succeeds for an unknown, expired, or deleted bearer,
  so an already invalid candidate counts as revoked.
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

Profile workspace controls advertise `initializeProfileWorkspace` separately
from ordinary `setProfileWorkspace`. Creation uses `onlyIfUnconfigured` with
the exact selected device and lane. The Service compares and initializes under
the existing Profile workspace writer lock, preserves later configuration, and
rejects malformed local metadata. An unsupported Service fails closed. This
capability does not create readiness or execution authority.

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
written to PostgreSQL, Agent Activity events or projections, cloud snapshots,
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
An otherwise eligible route remains registered with a missing or invalid
default working-folder fact (Default Project or Profile workspace) so an
explicitly selected Project/repository can be delivered. The observation still
blocks ordinary Wake readiness and launch.
The inherited execution Host catalog IPC carries ready, missing, and invalid
current working-folder resolutions; it cannot require a ready path merely to
register a route with a precise unavailable fact.
Dispatch admission compares the route's observed source, Default Project and
local binding generation when applicable, status and reason, and effective
directory when ready with the current durable local configuration. Once a
connection or Profile workspace
mutation is durable, an older route cannot launch new work; catalog refresh
only controls how quickly the new route becomes available again.
For an accepted Execution Context with `projectWork`, the Service first
performs that current-route check, then resolves the frozen Project and
repository fingerprint against current owner-local, Organization-scoped
connections. One matching folder is required; a matching Project default may
disambiguate several clones. Missing, removed, and ambiguous matches fail
closed without using the Profile's Default Project folder. The existing file
access and native workspace preparation checks then apply to the selected
folder. Local binding store v4 permits a canonical path to have several
same-owner, same-Organization Project uses only after explicit share
confirmation. Removing one use does not remove the folder or other uses.
The selected-work resolver requires a binding recorded for the current
Service account owner. Ownerless legacy connections remain readable for old
work but cannot authorize the new selected-work contract until explicitly
reconnected. Discovery does not disclose paths bound to another known owner.
Every durable local Project connection writer emits the same lane-local catalog
refresh signal, while an idempotent no-op emits nothing.

Execution Host connection refresh replaces the contents of its shared route
map in place. Already queued dispatches must read that same map at admission
so they see refreshed working-folder facts and route removals. Refresh does
not relax the current identity, durable configuration, or freshness checks.

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

## Saved Working-Folder Reads

The optional `localAgentControl.readProfileWorkspace` registration capability
admits one private read of the existing account-scoped Profile configuration.
Runtime Transport selects the exact owner/device/lane's compatible live session
and correlates `daemon.local_agent_control.read_profile_workspace` with the
existing Local Agent Control result frame. The admitted Service account remains
the local trust boundary; a changed account rejects the result.

Core checks the Profile's Auth owner and active Organization before forwarding
the result, and checks them again after the read. A Binding-based editor also
verifies its existing `expectedBindingTarget` before and after the read. These
checks do not acquire a mutation lease or create another Binding authority.
The no-store HTTP response contains configured/missing/invalid configuration,
and includes a saved path only for immediate forwarding to the requesting owner.
It does not publish paths to Profile identity, logs, Agent Activity or Center
Agent context. Reading never migrates the configuration or provisions a folder.

The configured result may include `configurationOrigin`, the kind of the
current local import or explicit-save observation. It exposes no native
conversation ID. The same local configuration envelope stores the observation,
and the existing writer removes or replaces it when the folder changes.
Unknown legacy origin remains absent. Origin does not authorize automatic
folder selection or change readiness. This final response shape is part of the
new private-read rollout: older strict result receivers can reject it, so the
complete Core/Gateway receiver must precede the publishing Service.

Old registration parsers strictly reject the new capability field even though
it is optional in the new schema. Deploy the Core receiver, then Gateway, before
the new Service advertises it or Web calls the new GET. A new receiver with an
old Service returns `local_agent_control.unsupported` and an update instruction;
it never infers configuration from execution history. Existing setup, Wake,
Space actions, writes and diagnostics remain valid without this capability.

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

Desktop Working folder uses the same Service picker after native account,
device, and lane admission. Its explicit PeopleComputer Project connection and
default-folder routes reuse the existing Project control business functions;
its explicit Profile workspace route reuses the existing workspace mutation
admission and Service writer. Every request revalidates owner inventory, the
exact live session, and the requested capability. Changing the account's current
Computer cannot redirect these operations.

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
enter command arguments, PostgreSQL, browser persistence, logs, traces, failure
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
job macOS never spawned from a crash loop with a nonzero exit code. Pending
spawn evidence alone does not prove a denied Login Items permission. It must
never establish service health, Wakeability, readiness, or permission to replace
a carrier. After an exhausted startup wait it may suppress an immediate repeated
start, independently of the user-facing diagnostic wording. A service-manager
`running` state corroborates lifecycle
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

Required local-component policy and optional binary-channel availability use
independent R2 reads and pending refreshes. The source reader owns their bounded
validity; RuntimeTransportHub must not retain an unchecked per-instance policy.
An unexpired policy serves queries immediately while a due refresh runs through
Workers `waitUntil`. The constructor and Service-registration entrypoint must
start release refresh outside `blockConcurrencyWhile` and attach it to the
background lifetime without awaiting it. The gates retain their local-state
initialization and persistence fences; registration reads the source's currently
valid snapshot. Neither gate may start R2 I/O or join a pending release read, including
on a cold start or after policy expiry. A never-settling R2 request must not
hold up initialization, connection-generation persistence, or registration ACK.
Heartbeat and synchronous context-migration checks also use the currently valid
snapshot, with heartbeat scheduling refresh in the background. Ordinary Core
policy readers may still await a cold required-policy read outside these gates.
Missing valid policy blocks new Wake admission in Core's update projection; it
does not make a live Service physically offline or revoke an in-flight
RuntimeCoordinator execution. The TTL and failure rules are owned by
[CLI binary release](../engineering/cli-binary-release.md#source-specific-binary-update-projection).

When a fast-path read reaps an expired route or service-liveness lease, Runtime
Transport may publish targeted `agent.readiness.invalidated` refresh signals for
the affected Agent Profile IDs. That publish is allowed only as bounded
housekeeping caused by the lease transition the read already observed. It must
not become a general read-path writer, broad invalidation sweep, route
registration authority, or Wake execution decision. If a future implementation
needs larger scans, it belongs in bounded alarm housekeeping instead of the
request path.

Core callers recover interrupted Hub reads as follows.

Cloudflare can replace a Durable Object instance without changing the Worker
version. Core retries only the audited idempotent Hub reads: work recovery,
Agent Profile execution state and operational contexts, and the three HTTP
lookups (`/lookup-route`, `/lookup-routes-batch`, `/lookup-owner-service`). Their
existing lease/index housekeeping is repeatable; it does not admit execution,
send device commands, authorize continuation, or publish results. Mutation RPCs,
device commands (including their read operations), and all other HTTP paths are
single-attempt at this boundary. A recovery action retries only its prerequisite
read, never the action itself.

Each read has at most three attempts, with full-jitter exponential backoff from
100 ms, and obtains a new DurableObjectStub for each attempt. `overloaded=true`
always stops retries, including when `retryable=true`. Otherwise only
`retryable=true`, or the exact platform inactive-instance message when that flag
is absent, permits a retry. An explicit `retryable=false`, other exceptions,
malformed responses, and HTTP/business responses do not trigger retries.

Allowlisted HTTP lookups also retry a locally timed-out attempt while their
overall budget permits it. Each attempt may use half of the effective total
budget: 2.5 seconds for route/owner-Service reads and 19 seconds for batch
route reads. This leaves room for a fresh-stub attempt without shortening the
batch read's existing 38-second total allowance. Each attempt has its own abort
controller, and its timeout covers fetch and response-body consumption. Before
backoff or another attempt, Core aborts the previous local transport wait and
clears its timer. Late completion cannot settle a later attempt. When the
remaining overall budget is shorter, the overall deadline takes precedence.
Direct RPC reads do not use this per-attempt timeout because they cannot abort
their transport; they retain retries only for the classified exceptions above.
A replacement gap covering the entire total budget can still make the read fail.
The member directory caps its batch prefetch at five seconds as well, so a
single unavailable Hub cannot outlast the directory's client request budget.
This internal caller cap may only shorten the default HTTP read budget and is
not part of the wire request. Its attempts use half of that capped total.

One overall deadline covers all attempts, backoff, and HTTP response-body
consumption.
Recovery reads have a 30-second total budget to allow a shutdown interruption
near the end of Cloudflare's drain window to recover. Execution-state and
operational-context reads use 5 seconds. HTTP lookup budgets remain unchanged:
5 seconds for route/owner-Service reads and 38 seconds for the batch route read.
An exhausted read preserves its last transport exception; an elapsed deadline
raises a read timeout. Neither becomes offline or missing-work evidence. Batch
transport failures propagate instead of triggering per-Profile lookup fan-out.
Existing execution-state and operational-context callers still map unavailable
reads to their explicit unavailable/checking projections.

The HTTP abort signal cancels local transport/body waiting where supported. The
direct RPC methods do not accept that signal: the deadline bounds caller waiting,
discards late completion, and starts no further attempt after expiry; it does not
claim that the receiver was canceled. These read deadlines never terminate a Wake or
change RuntimeCoordinator execution authority. No new concurrency gate or
cross-request pending cache is introduced.

Failures emit `runtime_transport_read_attempt_failed` at the caller before error
translation. Logs contain the operation, per-read correlation ID, caller request
ID when available, Durable Object ID when a stub was obtained, attempt number,
elapsed/budget/backoff milliseconds, retry decision, and the boolean or missing
(`null`) `retryable`, `overloaded`, and `remote` properties. The exact known
inactive-instance error is recorded as a boolean classification. Native
Cloudflare trace/request metadata provides correlation when an application
request ID is unavailable. Bodies, tokens, raw messages, and stacks are not
logged. `remote=true` alone is not a retry classification. Elapsed times describe
caller waiting, not receiver execution or CPU duration.

HTTP attempt logs also include `attemptTimeoutMs` and `attemptTimedOut` to
distinguish local attempt expiry from Cloudflare exception properties. A local
attempt timeout leaves absent platform `retryable`, `overloaded`, and `remote`
properties as `null`; total-budget exhaustion remains terminal.

This follows Cloudflare's [error-handling guidance](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/)
and [shutdown lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#shutdown-behavior).

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

RuntimeTransportHub emits `runtime_transport_gate_phase` Worker logs for its
constructor and Service-registration concurrency gates. Each record carries
`durableObjectId`, a per-instance `bootId`, a per-operation `gateId`,
`gateKind`, `stage`, `status`, and elapsed/stage duration in milliseconds.
The `gate` stage covers the whole callback; named stages identify its critical
awaits. A `started` record is emitted before each operation, so the last stage
without `completed` or `failed` remains visible if the platform resets the
object. Correlate it with native reset logs for the same Durable Object and
instance; an absent completion alone does not prove a reset or identify an
unlogged dependency inside that stage.

Release refresh is background work outside both gates, so new gate logs do not
emit the historical `release_refresh` stage. A completed gate does not establish
that R2 finished or that valid policy is available. Use native R2 spans and the
release-source error logs for that separate operation.

`elapsedMs` and `durationMs` use `performance.now()`. The Workers clock advances
at I/O boundaries, so synchronous work can report `0 ms` even when it takes
time. A zero duration does not establish that a stage was fast; these values
are neither CPU measurements nor measurements of I/O wait alone. See
[Cloudflare's timing limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/#non-io-operations-may-report-time-of-0-ms).

Named stages cover critical awaits, not every synchronous operation. Socket
adoption, lease reaping, and reasoning-preference schema parsing remain covered
by the whole `gate` stage. With complete logs, a failed gate without a failed
named stage points to uninstrumented synchronous work or code between stages.
Treat this as an investigation lead, not a definitive failure location: missing
stage records can also reflect incomplete log delivery.

These records contain only diagnostic metadata, never request/response bodies,
session credentials, release manifests, or raw exceptions. A completed gate
means the callback returned; it does not establish registration acceptance,
Service liveness, Wakeability, or execution success. Logging preserves existing
gate ordering, exceptions, deadlines, and authority boundaries.

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
- One OpenMeld Service process binds its account principal at startup. It
  reuses the secure-storage cache and adopts changed credentials only for that
  same account, Auth authority, and client. Clearing or switching the CLI account
  cannot make accepted work use another account's credentials. Same-account
  renewal uses the existing credential writer; an in-memory renewal deferred
  during admission is persisted on a later read if the local principal still
  matches. A new Service process resolves its own startup principal. Remote
  authorization checks still decide whether the bearer session is valid.
  During a same-account setup transition, a Service admitted for the candidate
  login reads that exact candidate's credential snapshot. It must not replace
  the candidate with the previous committed login just because both share an
  account. The Execution Host independently verifies the same session identity;
  commit and rollback remain owned by the existing auth transition journal.
- One OpenMeld Service process reuses a verified credential for the same
  committed login, storage reference, lane, auth origin, client and account.
  Organization selection and display-only profile changes update context
  without evicting that credential. Security-relevant metadata, including
  expiry and scope, retains conservative invalidation for supported legacy
  same-reference writers. New credential rotations use unique references.
  Full-payload transaction fences remain separate and unchanged. Clearing or
  replacing the login invalidates its cached identity; a slow read rechecks
  current metadata before returning. Concurrent reads of the same credential
  are coalesced. A new Service process reloads from secure storage, and remote
  authorization remains authoritative.
- An Auth-confirmed renewal that retains the verified access token and storage
  reference updates expiry without reopening secure storage. This applies to
  committed sessions and visible setup candidates, including admitted Service
  sessions. A rotated credential still requires successful storage read-back
  before new metadata or candidate state is published. Mutation ownership,
  full-payload fences, revocation checks, and rotation cleanup remain unchanged.
- Reading a committed local session does not acquire the account-transition
  mutation lock when no durable transition journal exists. Recovery acquires
  that lock only after observing a journal and rereads it under ownership before
  changing anything. Pending candidate visibility, interrupted transition
  recovery, and mutation serialization remain unchanged.
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
  child and observes a 30-second cooldown before another Keychain attempt.
  The existing carrier recovery scheduler honors this retry eligibility;
  successful credential recovery wakes a waiting transient retry. Local
  unavailability remains degraded connection evidence and does not consume
  the invalid-login backoff ladder. A command authentication check may re-evaluate the
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

An accepted Wake does not inspect Service installation, bundle, supervisor, or
whole-machine process inventory merely to inject maintenance advice into the
Agent's prompt. Service update and repair guidance belongs to maintenance and
the diagnostic/product surfaces. Dispatch preparation retains its owning
identity, route, workspace, permission, and execution checks; removing advisory
maintenance work must not bypass those checks or alter reply-context review.

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

Background controller status and session-inventory probes must also suppress
console creation on Windows. A GUI Service parent and piped stdio alone do not
provide that guarantee: direct Node-compatible child launches use `windowsHide`.
This does not change the interactive CLI launcher's terminal behavior.

For the retained npm distribution, both tasks start a lane-owned Windows-subsystem host,
not a console-subsystem PowerShell process. The host creates the existing system
PowerShell action with `UseShellExecute=false` and `CreateNoWindow=true`, waits
for it, and returns its exit code without detaching or breaking Task Scheduler
process ownership. `-WindowStyle Hidden` and the task's `Hidden` setting are not
substitutes for preventing a console at process creation. The existing encoded
action remains the only command/environment configuration and retains its log;
outer PowerShell/host failures are appended beside the host as `<host>.log`.

The encoded Windows action has one canonical four-field contract: `executable`,
`args`, `env`, and `logPath`. Its serializer projects and validates those fields
rather than serializing a wider Service or maintenance registration spec.
`workingDirectory` belongs to the Task Scheduler action, and `pendingJobPath`
is maintenance registration metadata; neither is an encoded execution field.
Readers narrowly accept the historical string-valued copies of these two fields
from released writers, discard them, and return the canonical action. Unknown
fields and malformed required or historical values still fail validation. This
read compatibility permits status, ownership checks, and normal guarded repair
of an existing task without deleting it or changing its user, permissions, or
console-free host. The compatibility decoder does not create another execution
configuration or make registration a claim of Service readiness.

For the managed Windows binary distribution, Task Scheduler directly starts
the selected verified x64 GUI Service (or an independent maintenance copy).
Visible role arguments and a private four-field action envelope must agree.
The entry applies its registered environment before importing business modules,
writes stdout/stderr synchronously to the existing task log, and passes those
file descriptors to the private Host while retaining its IPC channel. Task
Scheduler observes the Service's actual exit status. Main Service replacement
requires stopped state. An owned direct maintenance registration may select the
next immutable copy while its current invocation finishes under the existing
maintenance lease; it must not stop or overwrite that running worker.

The existing npm compatibility path still compiles fixed bundled C# source with Windows PowerShell
5.1's .NET compiler into a temporary WindowsApplication and atomically installs
it at `<lane legacy script>.task-host-v1.exe`. Main and maintenance tasks have
separate hosts, so neither replaces the other's running image. Compilation or
replacement failure stops installation without falling back to a visible
console, changing security policy, or requiring elevation. Read-only status
never compiles. An owned stopped legacy PowerShell task is upgraded through the
same install path; running tasks must first drain/stop under existing lifecycle
rules. No new account, password storage, WSH dependency, or scheduler is added.

The Windows adapter retains the serialized `windows-service` controller identifier
for supported local-state and wire readers; that identifier does not imply SCM.
New installations do not register batch files as SCM executables. A legacy SCM
registration is migrated only after it stops and only when its executable matches
this lane's exact legacy script. A different installation or insufficient migration
permissions fails visibly. The replacement task stays disabled until the old
registration is removed, so migration cannot create two execution owners. Task
Scheduler's registered action is the source for command and environment diagnostics;
new installs do not maintain a parallel batch-file configuration.

On macOS, the managed LaunchAgent uses `RunAtLoad=true` and
`KeepAlive.SuccessfulExit=false`: an abnormal exit is restarted, but a successful
controlled drain must not spawn a replacement before the authorized Stop caller
unloads the job. `launchctl disable` changes future loading eligibility; it does
not cancel an already loaded job's unconditional keepalive. Account/PID checks
remain mandatory, and Stop still requires actual Host exit and manager teardown.
Normal update and explicit Start paths load/start the registered job themselves;
they do not depend on respawn after a successful drain. Existing unconditional
keepalive definitions are detected as startup-policy drift and reconciled through
the existing guarded lifecycle path, never rewritten underneath a live process.
It declares `ProcessType=Interactive` because people are waiting for its Wake
execution and replies. Omitting that classification allows macOS to throttle
the carrier's CPU and I/O as background work; child controller processes can
inherit lower-priority execution even when their task-level nice value is zero.
The Service receives user work through Runtime Transport rather than macOS XPC,
so `Adaptive` cannot infer that a remote Space user is waiting. Use the OS job
classification instead of per-runtime priority wrappers or longer startup
deadlines. Installation and normal Service updates write the same lane-owned
definition; Linux and Windows keep their platform-specific scheduling defaults.
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
closed unless its lane and root identify the same owner. The production service
identity may be mutated only from the published production root; an explicit
`OPENMELD_ENV_PRESET=prod` cannot authorize an isolated root. `openmeld-dev`
always selects `dev-local`, even when its parent environment carried a production
preset or production Auth, Gateway, and client defaults. Explicit lane-local
endpoints remain intact. For compatibility, `OPENMELD_ENV=dev` resolves to the
same `dev-local` lane; conflicting legacy and canonical selectors fail instead
of choosing one silently. Test processes never mutate the published production registration.
Isolated validation targets the `dev-local` or `canary` service identity or
stubs the service manager. A dispatch-owned runtime may inspect production
Service state, but it cannot run a production Service mutation that could stop
or replace the carrier currently executing that dispatch; it may use a confirmed
development lane for isolated lifecycle validation.

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
On POSIX systems, native commands invoked inside that owner attach a separate,
owner-scoped entry to the same lock directory before execution. A fixed shell
handshake waits for attachment, then uses `exec` with structured argv so the
recorded PID and process-start identity remain the native command's identity.
EOF or failed attachment before the grant prevents execution. A surviving native
command retains the fence after its requesting CLI dies. Recovery removes only
recognized entries whose exact owners are all proven dead; unknown entries and
unknown process identity fail closed. There is no live-owner timeout. Older
single-entry readers cannot remove a nonempty multi-owner directory, including
after their malformed-lock grace period. Read-only probes outside a lifecycle
operation do not acquire this lock. On Windows, Task Scheduler control uses the
same owner-scoped entries with the exact process creation FILETIME. PowerShell
waits for an explicit stdin grant before any COM operation; failed attachment or
EOF before grant has no Task Scheduler effect. Once granted, a surviving control
process retains the fence until its exact owner exits. This is separate from a
Wake Job: the independent OS-scheduled Service must survive the requesting CLI.

### Account-checked Service start and stop

`service start|stop --json --expected-account <account-id>` admits one operation
against an already connected Service. It is not setup, login, installation,
account takeover, or permission to change another account's Service. The CLI
verifies the bearer principal through Auth before taking lifecycle ownership,
then rechecks the local credential snapshot, lane, Auth authority, device,
connected-computer ownership, and contract generation under the auth mutation
mutex. The lock order is lifecycle then auth; no OS command, startup wait, or
work drain holds the auth mutex.

The bounded Computer Disconnect command composes this Stop with exact-session
auth cleanup. Its optional reviewed session identity is checked inside the same
admission mutex before reservation, so a new session for the same account cannot
be stopped by an old review. The existing reentrant lifecycle lock covers Stop
and cleanup; auth cleanup rechecks the reviewed session and preserves any later
sign-in. This adds no Service lifecycle owner. Failed Stop retains credentials;
only explicit matching stopped intent plus verified runtime absence permits a
retry to finish cleanup without stopping again.

The auth-owned `auth/service-account-admission.json` file contains the current
command reservation/outcome and at most one receipt of an accepted Start.
Updated credential writers and transition recovery reject a live pending
reservation. Dead requesters produce a durable cancelled command, never deletion
that could authorize a delayed child. Reserving or cancelling another command
preserves the accepted-start receipt. Only successful Start admission replaces
it, atomically with its outcome under the same auth mutex.

The receipt contains the immutable Start ID and a digest binding it to the
canonical account, Auth authority/client, Gateway, lane, device, and Service
contract generation. It is evidence of past authorization, not an identity
store or current Service state. Startup passes its ID in argv. The carrier must
match the current auth and canonical Service facts, including background desired
state, before using that receipt. Existing runtime ownership still prevents two
active Services. Changed canonical facts invalidate the receipt on read, without
requiring older contract writers to maintain it. A cancelled or unadmitted Start
ID never receives restart permission. A later refused/cancelled Stop cannot erase
an earlier accepted Start; a lost startup acknowledgement can recover from its
durable receipt. Supervisor disabled state and normal stopped desired state
continue to prevent a stopped Service from restarting.

Stop uses the existing authenticated shutdown payload and releases auth
protection when the exact carrier accepts the existing controlled stop. Its
response waits for drain, but the CLI caller has a fixed total request deadline.
Progress bytes do not extend that deadline. Caller timeout closes only its
control connection and never cancels admitted drain or accepted work.
The lifecycle owner persists explicit stopped intent and disabled autostart before
waiting for the carrier. This is desired state, not proof of completed shutdown.
An idle Host can settle without a cloud connection; retained results stay in its
durable outbox for the next explicit start. A missing final offline acknowledgement
does not justify endless reconnection after local work is quiescent. Active work
continues to use replacement connections until its existing drain completes.
Commit can precede outcome persistence:
a pending record therefore does not prove refusal. Only the coordinator's
explicit `service.account_admission.stop_refused` response proves pre-commit
refusal. It permits restoring the exact previous intent and autostart setting only
while the stopped contract written by this request is still current. This rollback
preserves the still-running carrier's generation; it is not a new Start. Once commit
has been reached, a persistence, drain, or transport failure is uncertain;
autostart remains disabled and the CLI reports `stop_unconfirmed` with the
underlying diagnostic. The existing coordinator retains drain completion/error
handling even if admission acknowledgement fails. No separate Stop machine is
introduced.
The CLI keeps lifecycle ownership through completion; it never falls back to
unverified stop or another PID. Account changes after admission cannot retarget
accepted work. A cancelled unadmitted ID, mismatched binding, corrupt record,
or unsupported carrier fails closed. An older carrier rejects the new argv or
shutdown field; that is not a positive coordinator refusal receipt.

This record owns only local operation admission. It adds no Wakeability,
RuntimeCoordinator, dispatch, Binding, or final-outcome authority. The persisted
Service contract remains the desired-state owner. The Desktop pilot exposes only this operation
after a separate read-only capability query proves its actual local pair.

`service control-capabilities --json` runs before layout repair or managed CLI
delegation. For the macOS binary pilot, it queries the canonical stable executable
that guarded Start installs into launchd, without invoking the repairing npm
launcher. The executable answers `service control-carrier-capability --json`
before delegation; the caller checks the responding executable path. When running,
the authenticated `account_control_capabilities` control request must also return
explicit support from the actual carrier. No status schema, lifecycle mutation,
startup attempt, shutdown attempt, or compensation is part of the query. Unsupported
or uncertain pairs return disabled controls. This capability is not Wakeability.

Windows npm installations use the same account admission, durable cancellation,
startup receipt, controlled drain, and exact-session Disconnect. Native process
creation FILETIME replaces POSIX `ps` identity; a live process with unavailable
identity remains fenced. The capability probe invokes the integrity-aligned
active JS entry directly with the exact Node executable that Start registers,
never the repairing launcher. Its Windows-only v2 response identifies both Node
and the entry script; a v1 response from an older Windows CLI does not prove
support. The old macOS v1 response is unchanged. A running carrier must also
confirm the authenticated control capability. Existing Windows tasks must use
the current SID's interactive token, ordinary privileges, and the expected
single action before any task mutation is permitted. Its executable must be
either system PowerShell (the supported legacy task) or this lane/task's exact
`task-host-v1.exe` path. Other executables remain refused. Pre-host CLI versions
cannot manage a migrated task and fail closed; use the matching newer CLI for
setup, repair and control. Cloud, Service transport, Wake and diagnostic payloads
are unchanged by this local launch-carrier change.

Managed Windows binary installations use the same account-admission protocol.
Their read-only capability probe runs the integrity-aligned active GUI Service
directly. Its `account-checked-service-control-v3` response identifies that
executable after verifying native process identity; it has no fictitious Node
entry script. A binary probe rejects the npm v2 response, and a Node probe
still requires v2 plus the exact entry script. The active bundle must remain
unchanged across the probe. A running Service must additionally answer the
authenticated local control request. Older readers reject the new variant
and leave controls disabled; the public Desktop capability shape is unchanged.
Direct GUI task admission retains the same SID, lane, action and process
ownership checks described above.

### Registration reconciliation

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

The current monotonic floor is OpenMeld Service `0.3.217`. It is the first
supported baseline that refreshes Service admission after update or draining
and carries the required Codex MCP startup behavior, in addition to the existing
working-folder facts and dispatch-owned reply observation. Once the stable
release manifest activates that floor, Core projects every connected older
Service as `update_required` and blocks new Wake admission without terminating
work already accepted by RuntimeCoordinator. The user-visible `requiredVersion`
is the newer of this compatibility floor and the current installable Service
release, so the action always names a version the user can actually install.
Before the stable release manifest reaches the source floor, Core leaves that
newer floor inactive rather than projecting `requiredVersion` above
`latestVersion`. A later advisory release may raise that remediation target,
but it must not lower or bypass an active compatibility floor. A Service already
at `0.3.217` remains supported and receives only the advisory update policy of a
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
legacy command-entry gap. Failure of that optional npm reconciliation does not
block setup through the verified managed binary; follow-up commands name that
binary explicitly.

After reading the manifest, setup first compares the lane-managed executable's
exact size and sha256 with the published raw executable record. It reuses an
exact match after verifying the declared Apple signing identity, without
downloading or reinstalling the CLI. A missing, truncated,
or same-size-but-different executable follows the verified download and
`install-self` repair path, which also forces Service carrier refresh.

Windows binary setup verifies the signed CLI and native helper, then follows
the shared managed installer receipt. Its GUI Service is a separate selected
artifact; neither Node nor the console CLI is used as that background carrier.
This entrypoint requires the accepted Windows artifact channel before rollout.

For explicit `?dist=npm` or npm recovery, the package-based commands
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

An already-running repair may report healthy only after an authenticated local
control response, a fresh Host control round trip, and the Core-owned current
device projection agree on the device and lane. The Host must be responsive,
admitting work, and past startup replay; the runtime contract must be compatible.
A live PID or an installed supervisor alone is insufficient. Active work does
not make a healthy Service unhealthy. Missing evidence remains a diagnostic
failure, not an inferred success. Status reads remain read-only.

On macOS, start inspects the exact lane's launchd job, bootstraps only a missing
job, and requests a demand start with `kickstart` without `-k`. It does not
restart an already running job. Bootstrap I/O repair has one owner, waits for
confirmed removal before reinstalling, and preserves the original and repair
errors if unsuccessful. Full lifecycle inventory still determines success.
Outside an active update, maintenance startup also restores its carrier from
the verified active bundle before trusting a saved OS registration. A plist or
unit can survive removal of the local executable; registration alone cannot
prove automatic updates can run. An active update keeps its existing executor.

Interrupted account handoff recovery belongs to explicit account flows: the
setup handoff, and `openmeld login` and `openmeld logout`, which finish it
before changing the sign-in. Generic command dispatch must leave install,
update, and diagnostics usable when the previous Service cannot start. Credential transition isolation and
candidate cleanup remain owned by auth-session storage.

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

The same Prepare stream may carry bounded, latest-only connection-progress
observations from the authenticated Terminal to Web. These frames do not write
Prepare state, increment `sessionRevision`, extend a deadline, or prove setup
completion. Core still accepts completion only from the existing Prepare step
and snapshot contracts; transport keepalive bytes are never progress evidence.

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

Setup observers read `service_update_readiness` through the existing local
control endpoint to distinguish accepted-work drain from installation. A
required update can remain `updating` while accepted work drains; the durable
phase alone does not prove that tasks finished. Accepted-work counts explain
the wait but never renew a caller deadline. The setup mutation lock has a fixed
15-minute lifetime. Desktop's read-only pre-authorization observer takes no
setup lock and stops observing after 30 minutes. Caller expiry never stops a
Wake or cancels the OS-owned update; it leaves a visible check-and-retry action.
This observation neither admits work nor changes Wake truth,
Service lifecycle, or the durable update job.

When the control endpoint is absent, the update worker delegates to the existing
locked lifecycle checks rather than waiting forever for an absent Service to
answer readiness. This does not authorize force-killing a live Service: controlled
drain or verified runtime absence remains required. Setup joins pending updates;
a newer Setup advances an older waiting job through that same coordinator before
joining it, so an old worker cannot replace a newly connected Service afterward.
This also applies to updates scheduled midway through setup. The caller observes
the same durable operation until it finishes, then rechecks the running Service
and account alignment before continuing. Missing completion evidence, a replaced
operation, rollback, or failure must not be presented as successful setup. The
observer does not acquire update ownership or start another update.

An explicit new setup first joins outstanding updates, then recovers any dead
handoff left without an executor before requesting a new account transition.
This keeps an early Terminal exit or an explicit Service stop from permanently
blocking the next setup.

The update worker also finishes the associated setup if Terminal exits. The
existing auth transition journal owns that intent and process-identity-fenced
adoption; Core Prepare still owns setup completion. An updated job remains at
its existing OS-watched path until setup and account settlement finish, allowing
the same worker to resume after a crash without reinstalling the Service. The
setup observer may consume that operation's verified `updated` result while
other account handoffs continue waiting for settlement. No browser success
override or second update/setup state machine is involved.

That update job is the single operation truth. Its safe projection reports one
of `waiting_for_work`, `updating`, `updated`, `restored`, or `needs_help` plus
the opaque operation id, request source, legacy aggregate target version,
optional CLI and Service target versions, urgency, and timestamps. Older
operations omit the split targets; readers use the legacy target for both
components. The operation shape does not carry failure detail. A stable,
fully-prefixed update failure code may instead appear in the existing CLI
component `reasonCodes`. Core projects only the first recognized allowlisted
code when the operation is in `restored` or `needs_help`; it drops the code when
the operation is absent or non-terminal. Web maps the surviving code to fixed
user-safe copy under that same terminal-phase gate. The Service includes these
projections in its normal local-component capability report; Core, Web, CLI,
and Center Agent must read them instead of inferring progress from connectivity,
component versions, or their own request lifetime. Local paths, commands,
stderr, unrecognized reason strings, and raw error text remain local.
Completed operation phases remain visible for at most 24 hours. Core must omit
an older `updated` phase when current component evidence already shows another
actionable update. A completed historical operation must never contradict the
current update action.
`waiting_for_work` and `updating` are in progress. `restored` and `needs_help`
are failed outcomes even if stale component fields happen to show the target
version. `updated` proves that the worker finished installation; clients still
retain that exact operation and verify CLI and Service against their respective
operation targets before presenting **Up to date** or allowing Setup or Prepare
to report completion. A CLI-only release may therefore finish while the
operation's selected healthy Service remains on an older version; matching the
new CLI version is not Service completion evidence.
Computer cards label terminal failures as the **last update** separately from
current connection and component requirements, retaining operation details and
the failure diagnostic. A newer Core-owned connection report for the same
device/lane and account-aligned session can confirm reconnection since the
attempt. It does not verify running artifact integrity, supersede component
update requirements, or rewrite the failed operation. Missing, old or mismatched
reports leave that recovery unconfirmed. Skills-only drift does not change
Service connection truth, and in-flight operations keep their current progress.
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

Installed artifact integrity and release freshness are different facts. A
self-contained Service is verified against its own copied files and recorded
fingerprint, never against the invoking CLI's current build directory. Binary
inventory verifies the selected Service executable in the same way as startup
and rollback. A CLI source change or removal cannot make a valid copied Service
corrupt; a changed installed artifact still requires repair. Read errors remain
errors rather than being accepted as a successful integrity check. Existing
version, lane, owner, and runtime-contract checks remain independent.

An npm repair or update must also prove that the selected package source is the
requested Service version before copying or activating it. This includes an
explicit CLI script path: its package root and package metadata are the source,
not the version requested by the caller. Missing, unreadable, differently named,
or differently versioned package metadata fails with an actionable error. npm
does not gain an independent Service publication path from this check; its CLI
and Service source remain the same actual package unless a future release
contract explicitly changes that ownership.

Default CLI lifecycle and diagnostic targets preserve a newer installed Service
version recorded by the service contract. That is target selection only, not
proof of health: inventory still verifies the selected files, lane, local state,
and runtime contract. Explicit version requests keep the downgrade guard. A
binary repair may reuse the retained source executable only when its bytes still
match the recorded fingerprint and any selected release fingerprint; it does
not trust the damaged running carrier or relabel the caller's CLI bytes.

Managed CLI cleanup retains the active binary Service's source version in
addition to the CLI current and rollback versions and pending update/worker
references. Retention ends when the active Service no longer references that
version. A production CLI release may select that exact retained Service only
when the release classifier proves no Service-owned input changed, the version
does not exceed the CLI target, and both immutable Service artifacts still
match the selected release metadata. Any Service-owned change keeps the release
coupled. Runtime health and alignment checks remain mandatory; compatibility or
version retention alone never authorizes skipping a Service update.

The binary update worker runs from a stable lane-owned carrier, not from a
version directory. A self-contained npm update worker uses a stable lane-owned
launcher that imports one verified bundle. Successful Service verification may
atomically replace the carrier or launcher; the running worker must never unload
its own OS registration as part of that replacement. Bundle cleanup treats the
launcher, OS registration, and durable pending job as recovery references, so neither the
registered carrier nor the replacement target can be removed while the handoff
is recoverable. Migration may likewise protect a legacy worker's pinned managed
version in addition to the current and rollback versions.

A CLI scheduling a new job first copies the verified worker and establishes its
OS registration, even when an older independent worker was installed. A saved
definition does not prove that its executor supports the new setup contract.
Maintenance repair also compares the saved definition with the current verified
program and environment. Switching between binary and npm installs must refresh
the OS command, not merely recreate a carrier the old command never invokes.
An already pending update retains its executor ownership. A maintenance child
must not unload its own OS-owned parent before publishing its job; that existing
worker replaces its carrier only after Service verification as described above.

Package version alone does not prove that the installed OS startup policy is
current. Service inventory observes the owned macOS scheduling policy, and
repair/alignment must recognize a same-version mismatch. This is advisory for
Wake admission. When automatic maintenance finds no package update, a worker
matching the installed Service version checks this policy and schedules any
correction through the existing available-update safe switch. It does not
restart an explicitly stopped Service, apply an older worker's policy to a
newer Service, or inspect the process inventory on each Wake. The recovery
carrier replacement ordering above remains unchanged.

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

CLI being current does not prove the Service is aligned. A normal upgrade
request joins an existing update first; otherwise the Tools update coordinator
also checks the existing Service alignment decision against the installed CLI.
The same maintenance operation schedules any remaining Service alignment,
preserving stopped intent and active-work drain. `upgrade --check` remains
read-only for Service lifecycle.

Controlled update, reinstall, and repair use a quiesce-and-drain stop. The
Service first rejects new dispatch admission with `service.draining` while
preserving dedupe for already-owned work. It keeps the current Runtime
Transport socket connected, continues heartbeats and execution progress,
waits for active local execution slots, flushes the existing durable dispatch
result outbox, and waits for Core's durable-acceptance receipts before closing
the socket. If the socket disappears during that wait, the connector exits
without waiting for Host drain. The existing Service reconnect loop restores
transport, and the existing controlled-stop coordinator carries the admitted
stop cause into the replacement session. The stop caller stays pending until
that session completes the drain, or the Service loop exits with failure.
The coordinator observes one Host drain operation across connection replacements;
repeated disconnects must not accumulate pending Host drain RPCs. A Host drain
refusal or failure rejects the admitted stop with its original error and clears
that failed observation so a later stop can check the Host again. Host errors
from beginning drain or settling results also reject the admitted stop; only
transport failures retain it for reconnect.
The same Host retains accepted work and closed admission; unacknowledged results
remain in the same durable outbox. Lifecycle code must not create a second
result store or start a replacement execution for that work.

A reply awaiting `accepted` or `review_required` still owns its execution slot:
a review can require another provider turn in the same task. `retry_later` is
not completion. Keep transport recovery and heartbeats available during this
wait, including when a resumed stop skips ordinary session bootstrap. A retired
connector's drain continuation must not settle or close a replacement connection.

On a new registered connection generation, the same result outbox immediately
replays each unacknowledged, non-terminal result once rather than waiting for
the previous connection's acknowledgement backoff. Subsequent attempts on that
connection retain the existing backoff. Original execution identity and tokens
remain unchanged; only Core's receipt settles the result. Dispatch journal
delivery evidence records time in the outbox separately from connection recovery.

If the first reply proposal cannot refresh Space context, preserve that proposal
in the same result outbox using the original Wake's source cursor, rather than
turning a temporary read failure into a failed task. This does not assert that
context is current: Space's atomic publication guard must validate the cursor
and require the existing reply-review continuation when context changed. A
failed explicit review cannot be replaced with a fabricated current observation.

The active-work drain has no fixed wall-clock deadline while execution remains
live. Once active work has drained, result-receipt and WebSocket-close waits are
bounded: an unacknowledged durable result remains available for replay, and a
half-open socket is terminated after its close deadline. The calling lifecycle
also bounds the control request so a new CLI cannot wait forever on an older
Service. That timeout is a compatibility fallback only during an actual version
upgrade; the existing OpenMeld-owned-process and long-stalled-heartbeat checks
remain mandatory before any automatic force kill.

The final stopping heartbeat must receive a successful Core acknowledgement.
A rejected or timed-out heartbeat cannot be reported as a completed controlled
shutdown. A failed connector can retire while the Host still drains; an admitted
control request remains pending across that reconnect. Network failure does not
authorize interrupting accepted work or assert that Core observed the stop. Core's existing freshness window remains the bound when no stop
heartbeat reaches it.

Repeated process-discovery failures are aggregated within a bounded local log
window, retaining the first occurrence, count, duration, affected controller,
and recovery event. Local diagnostics preserve stable reason codes including
`process_discovery_timeout`, `controller_check_timeout`,
`result_ack_timeout`, `socket_close_timeout`, and
`service_reconnecting`; repeated connection failures remain degraded evidence
while background reconnect attempts continue. An acknowledged Service heartbeat
resets consecutive retries. The first failed connection clears local online
status immediately. Disconnect, subsequent connection attempts, and the next
acknowledged connection share a recovery identifier and elapsed time in the
existing local lifecycle journal, including while offline. These are observations,
not another recovery controller or a claim about the original cause of an outage.

The daemon-stream application keepalive owns at most one unanswered PING at a
time. Its PONG deadline is fixed when that probe is sent; a later interval that
becomes runnable after a scheduling gap must not replace or extend the deadline.
A current-socket PONG clears the probe, while expiry terminates only that socket
and returns recovery to the existing Service reconnect loop. Timer delay is a
reason to revalidate transport, not evidence that the computer slept or that a
particular network component failed.

The carrier also records a strict, account-partitioned connection-evidence
journal under its existing runtime-state directory. It retains at most 32
incidents, 100 events per incident and 1 MiB, pruning records older than seven
days on load/write. Repeated adjacent observations are aggregated; truncation
is explicit. Pending event writes are capped at 128 so a stalled filesystem
cannot accumulate unbounded work. Writes and uploads never block registration
or heartbeat.
Completed incidents upload after registration, and an interrupted incident from
a previous Service process uploads on its next connection. Receipt replay is
idempotent. Upload retries have their own bounded backoff, retry promptly on
reconnection, and cannot reconnect the carrier; an account change prevents uploading old evidence with new account
credentials. Safe native network codes and observed phase are retained when
available. Unknown runtime errors remain unknown. Retry scheduling delay does
not prove OS sleep, a DNS problem, or a provider outage.

Reply reconsideration retains its existing exact-conversation behavior. Its
existing dispatch journal additionally records the relevant signal IDs/count,
typed reason, start and duration, without signal text or prompts. A finished
reconsideration observation is not evidence that a Space reply was published.

Registration and heartbeat never await optional local-component inspection.
One Service-lifetime observation coalesces that inspection across reconnects
and may reuse a result for at most 30 seconds; absent or expired observations are omitted rather than
renewed as fresh component evidence. A completed observation can schedule a
heartbeat after registration. Missing component evidence does not grant
component readiness or bypass the Core-owned update projection.

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
is a deploy. An unexpected process exit is `service_crash`. Connection-state
observations keep an unknown stop cause unless an explicit cause is supplied;
starting, authentication failure, and successful registration must not be
classified as network disconnects. They identify the actual Service process,
not a concurrently running CLI lifecycle command. The lifecycle journal, Runtime Transport heartbeat/trace, and
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

When the bounded wait elapses for a Service that is still alive, its controlled
stop is still in progress; that is not a failed stop. The warning says so and
points to Service status before `--force`. A Start that runs meanwhile observes
that Service as this lane's current owner and reports it as already running; it
must not classify the live owner as damaged service files that need repair.

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

The shared Wake workflow may suggest incorporating the requester's clear
follow-ups to the current task within existing permissions and execution mode.
This guidance creates no Wake, queue entry, automatic rerun, or guarantee of
model behavior. A final-action review cannot perform new implementation work;
its reply should identify unfinished requests without implying that an
acknowledgement started or queued them.

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
SDK or CLI fork and applies its temporary Plan mode only there. OpenCode 1 repair
uses the official Server session fork and passes the Binding's unchanged
`OPENCODE_PERMISSION` JSON to the child. Each adapter continues to report the
validated canonical conversation identity. If the installed controller cannot
create the required isolated child, repair fails explicitly while ordinary
Wake, setup, status, and diagnostics remain available.

OpenCode 2 and Antigravity ACP currently reject delivery-only repair explicitly:
their exposed APIs have no verified exclusive tool scope equivalent to the
existing repair contract. Ordinary native MCP publication remains supported.
Do not silently rerun a failed action with broader tools, mutate the canonical
session's permissions for repair, or claim successful publication from text.

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

`carrier/daemon-frame-transport.ts` owns frame parsing, registration and
heartbeat acknowledgments, and transport-error correlation without importing
the dispatch/adapter graph. Execution frame handling remains a separate
consumer. This module boundary alone is not process isolation or a change to
execution ownership.

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

A supported controller may separately call the dispatch-scoped
`report_progress` tool with a short deliberate public update. The Service keeps
an in-memory deduplication set for the active turn, sends a bounded accumulated
snapshot through RuntimeTransport, and drops the capability when only final
action repair is allowed. The tool does not write the final action record and
has no standalone CLI fallback, so a child process cannot bypass the active
Service execution token or turn progress into a second Space writer.

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
## On-demand local agent history

The optional `session-history-v3` transport capability admits bounded read-only
local agent history requests. The Service owns the local Organization-scoped policy
and the latest 200 metadata-only access records. Grants pin Project connection
generations; reconnecting requires renewed consent. File access restrictions
intersect this policy. Recheck policy, canonical source path, and current Project
connection before releasing messages. Persist neither source text nor provider
errors in the policy/audit store.

Codex uses native `thread/read`, first without turns to authorize the source
directory, then with turns to project user/assistant text. Claude Code uses the
official SDK's `getSessionInfo` and `getSessionMessages`. OpenCode uses read-only
SQLite connections and projects native text parts. Grok Build reads metadata
before its bounded `updates.jsonl` ACP stream. Each provider authorizes the source
directory before message reads and again before release. Native identity and
provider stay paired across clients, tools, routing, results, and audit.
Do not resume, inject, index, or
copy source transcripts. Core owns caller authentication and verified human
provenance; local Service enforces owner, reader, Project, and policy scope.
This capability does not change Wake execution ownership or readiness.

## Computer sleep prevention

Computer power settings belong to the local Service execution host. The
`computer-power.json` file in the Service data root is the only saved preference.
It defaults off. The Desktop Personal > Desktop page and the selected Local
Computer page use the same owner-authorized, explicit device/lane API and UI.
They never save another preference in Desktop, the browser, or an Agent Profile.
Writes carry the last observed revision; stale writes fail rather than overwrite.
Disconnected and unsupported Services are unavailable, not unchecked.

Power-control waiter failures retain the shared rejected-result envelope:
timeouts use `computer.power.timeout` / HTTP 504, a disconnected Service uses
`computer.power.offline` / HTTP 503, and invalid replies use
`computer.power.invalid_response` / HTTP 502. Core maps a missing transport
response to `computer.power.unavailable` / HTTP 503 rather than parsing it as a
successful power state. Other Service rejections retain HTTP 409. A timeout or
lost reply does not prove that an update was never applied; no layer replays
the update, and the user must check the current preference before retrying.

The execution host reconciles the preference with the canonical active execution
slot count after ownership changes, including release. Queued tasks, observed
external sessions, remote tasks, and an idle Service do not acquire a request.
The last active local task ending, disabling the setting, or Service shutdown
releases it. Cloud socket replacement and Desktop exit do not own the request.
macOS uses `/usr/bin/caffeinate -i -w <host-pid>`; Windows uses the bundled native
helper with `ES_CONTINUOUS | ES_SYSTEM_REQUIRED` on one thread until the
Service-owned input pipe closes. Neither requests display wakefulness or changes
system power settings. Forced sleep, closing the lid, low battery, and shutdown
remain operating-system decisions. Linux reports unsupported in this version.

The `x-openmeld-computer-power: 1` handshake negotiates the capability without
adding unknown fields to older strict registration payloads. Core validates the
human owner and selected Computer, and the transport resolves the latest exact
owner/device/lane session. The execution host checks the device again. Read
responses include saved preference, actual held-request state, and a problem
when acquisition fails. Both UI entries refresh every five seconds and on focus
only while the selected device/lane has a connected session in the Core-owned
Computer inventory. A saved execution target does not establish a live connection.
If a power request reports `computer.target_disconnected` before that inventory
updates, automatic reads pause and the failure remains visible. Polling resumes
when the matching session supplies a newer heartbeat or the user retries
explicitly; another disconnected response pauses it again. Refreshing an
inventory with the same heartbeat is not reconnection evidence. Mutations update
the shared account/device/lane query immediately after confirmation.
