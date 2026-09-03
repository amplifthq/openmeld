# Agent Profiles

## Agent Context

- Purpose: Define the Agent Profile product model and its relationship to
  identity, instructions, Space membership, Binding, local controllers,
  workspace intent, Default Project, readiness, and reply recovery.
- Read this when: You are changing Agent Profile semantics, Agent Profile
  Binding behavior, Space agent membership, local-agent selection, workspace
  behavior, Default Project behavior, readiness, reply recovery, or Agent
  Profile copy.
- Update this when: Agent Profile ownership, Binding semantics, readiness
  interpretation, controller relationship, or user-facing agent lifecycle
  changes.
- Do not use this for: Runtime identity ownership, OpenMeld Service lifecycle,
  RuntimeCoordinator execution truth, Space thread mechanics, endpoint details,
  test commands, speculative routing models, or low-level schema implementation.
- Source of truth: This file owns the durable product semantics of Agent
  Profiles in OpenMeld.

## Product Role And Identity Boundary

An Agent Profile is the AI teammate identity users collaborate with in OpenMeld.

Users should understand it as the named AI collaborator they can invite into a
Space, address in conversation, Wake for work, and recognize across replies.

An Agent Profile owns product identity and collaboration meaning:

- name
- instructions
- persona
- continuity
- visible teammate identity
- Space membership meaning

An Agent Profile name is a practical label for distinguishing the member,
Session, and execution configuration. Ordinary interactive creation must not
make a user invent a role or create one profile per task. It proposes a factual,
editable template name from the owner, selected Agent Controller, model, and,
when useful, reasoning level, for example `Felix Lu Codex GPT-5.6 Sol Xhigh`.
The template uses plain spaces rather than possessives or decorative separators.
If the proposed visible name already exists for that owner, the creation surface
adds the first available numeric suffix such as `(1)` or `(2)`.

The name field appears at the final review rather than blocking the first
decision. While the name still matches the managed template, configuration
changes update it automatically. Once the user edits the name, later
configuration changes must preserve the user's text. When the Center Agent or
another assistant creates an Agent from an explicit work goal, it may instead
infer a short practical role name such as `Release Reviewer` or `API Debugger`.
An explicit user-provided name always wins.

It does not own local execution truth.

An Agent Profile is not a Runtime, computer, OpenMeld Service, controller binary, or
local process. Those objects may help the Agent Profile reply, but they are
local execution infrastructure, not the teammate identity users collaborate
with.

Ordinary Agent Profile avatars intentionally use the bound Agent Controller's
brand mark, such as Codex, Claude Code, Grok Build, Cursor, or OpenCode, because the mark helps users
recognize how that profile runs. Rebinding an ordinary Agent Profile updates
that mark. An unbound or unknown controller uses the generic agent fallback;
it must not invent Controller branding.

OpenMeld also has Human Profiles. A default Human Profile is created for the
signed-in user and is the right identity when a human or their current AI
assistant operates OpenMeld on the user's behalf. That is different from creating an
Agent Profile. The same default Human Profile follows the account across
Organizations. OpenMeld does not expose additional Human Profile creation while
Auth's additional-Human-creation capability is disabled; this does not hide or
invalidate existing non-default Human Profiles.

The platform may create managed Agent Profiles only for explicit system roles.
The current system role is the org-scoped `managedRole = "center_agent"` profile
for each org's Center Agent, including personal orgs. Legacy
`managedRole = "openmeld_assistant"` profiles are retained as historical data
but are hidden from the ordinary Agents home and are not created by current
setup. The Center Agent profile is managed from the Center Agent surface, not
from the ordinary Agents home. Setup does not choose or repair a managed
profile's Binding, model, Agent Controller, or Wake health. Ordinary Agent
Profile creation and profile execution management still require explicit user or
assistant intent.

An ordinary or managed Agent Profile created from an Organization surface
belongs to that explicitly selected Organization. The route Organization is
part of the creation command; it must not be inferred from a mutable Better
Auth Session selection. Auth verifies that the signed-in account is currently a
member before it writes the Profile. Later Binding, working-folder, Default
Project, readiness, Wake, and Space-membership steps must keep that same
Organization id. Personal Workspace profiles remain in Personal Workspace;
profiles created in another Organization remain in that Organization. No
authorization row, preference, Binding, or membership may make an ordinary
workstation Agent Profile usable by another Organization. A mismatch fails
closed instead of creating, presenting, or executing a cross-Organization
identity.

A successful Agent Profile identity write is the creation commit point. A
client must never report a later Binding, working-folder, Default Project,
readiness, or Space-membership failure as if Profile creation
failed, because retrying the create would produce a second teammate identity.
Every interactive creation intent carries one stable idempotency key until
Auth returns the committed Agent Profile. An exact retry or concurrent replay
returns that same Profile; it must never create a second identity. Reusing the
key for a different name, Organization, or creator under the same owner fails
with an explicit conflict. A client-side in-flight guard improves immediate
feedback, but Auth's durable idempotency boundary remains authoritative when
rendering, transport, or network retries overlap.

Every created Agent Profile keeps immutable creation attribution: the exact
Profile that acted and the surface that initiated the action (`web`, `cli`,
`local_agent`, or `center_agent`). The owner and actor are separate facts. A
Center Agent or Local Agent may act for a human requester without becoming the
new Agent Profile's owner. Profile Details shows the human-readable creator and
source; exact internal identifiers remain an Advanced detail.

When a supported local Agent asks to add itself to a Space, that intent creates
a new Agent Profile by default. A client must not enumerate the account's
profiles or inspect unrelated Bindings to guess which identity to reuse. Reuse
is allowed only when the caller supplies the exact Agent Profile ID it remembers
creating for the same controller Session; the client validates only that
Profile's ownership, Organization, Binding, and Project folder. An exact active
Profile with a confirmed missing Binding is a resumable partial creation: the
client completes that Profile instead of creating a duplicate. A Profile already
bound to another controller Session is not repurposed; the default new-Profile
path remains authoritative. Ambiguous ownership, an unavailable Binding read, or
an ambiguous session identity fails closed instead of selecting a nearby match.

Clients may expose an explicit owner-scoped lookup from an exact controller ref
and exact controller Session ID to the one bound Agent Profile. This is a
recovery aid for a caller that remembers creating a same-session identity but
lost its Profile ID; it is not a discovery step in the default self-add flow.
The lookup performs one Binding reverse read and reports whether the result
belongs to the active Organization. It must not enumerate Profiles, inspect
unrelated Bindings, or silently choose a Profile from another Organization.

## Agent Profile Creation Requests

An Agent Profile Creation Request is the one Organization-scoped coordination
flow for creating an Agent Profile owned by the requester or by another member.
Web, CLI, Local Agents, and the Center Agent use the same Core-owned request
state machine rather than implementing separate approval rules.

Each request freezes these product facts:

- requester user and acting Profile
- target owner user
- initiation source
- Agent Profile name
- Session strategy: `new`, `resume`, or `fork`
- the exact provider-native Session ID for `resume` or `fork`
- the selected Computer and Agent Controller, when known
- the exact local-agent connection candidate ID when the Center Agent selected
  one from the current candidate projection
- the requested Binding settings and Default Project
- an optional intended Space
- one requester-scoped idempotency key

OpenMeld does not mint, translate, normalize, or replace provider-native
Session IDs. A Project's Agent Activity authorization boundary decides which
local Sessions the Organization may see; creation callers pass the exact native
ID from that projection.

`new` starts with a separate local Session. `resume` continues the selected
Session. `fork` creates an independent child Session that inherits the selected
Session's context without interrupting it. UI copy may give a light warning
before resuming a currently working Session, while Center Agent and Local Agent
guidance should prefer fork for that case. The request contract does not add a
second policy engine that guesses or rejects the user's choice.

OpenMeld publishes each built-in Agent Controller's native conversation
capabilities through the team-safe Organization Computers projection. Resume
is supported by reference ID for Codex, Claude Code, Cursor, Grok Build,
OpenCode, and OpenClaw. Native fork by reference ID is currently confirmed for
Codex, Claude Code, and OpenCode. Grok Build, Cursor, and OpenClaw report fork
as unsupported until their installed controller contract exposes an operation
that returns a new native Session ID while preserving the source context.
Clients must render this fact honestly and must not imitate Fork by injecting a
summary into a new Session.
Capability reporting informs selection; it does not authorize Session access
or perform the operation.

Each member controls two independent per-Organization policies: one for new
Sessions and one for existing Sessions. Each policy is **Ask every time**,
**Automatically allow**, or **Never allow**; both default to **Ask every
time**. A self-request does not require redundant approval. A pending teammate
request creates one Inbox action for the target owner. Only that owner may
approve or decline it, and only the requester may cancel it. Both participants
can see current progress and immutable origin attribution.

Core atomically claims an approved request before starting any Profile creation
side effect. An `approved` request is therefore presented as **Creating Agent**,
and cancellation is no longer available after that claim. Completion and
failure writes are fenced to the exact creation attempt so concurrent retries
cannot run the executor twice or overwrite a newer outcome. If approval remains
unclaimed for 30 minutes, or a claimed attempt has no terminal result for that
long, Core changes the durable request to an explicit retryable failure. Retry
makes a new fenced attempt instead of leaving the request permanently stuck.

If Auth has already committed the Agent Profile identity when a later Space,
Binding, working-folder, or Default Project step fails, the durable request
keeps that `createdAgentProfileId`. The compatible public combination
`status: failed`, `statusReason: profile_created`, and that non-null ID means
identity creation succeeded while setup remains incomplete. Retry preserves
the exact Profile ID and continues the idempotent setup steps; it does not call
Auth to create an identity again and never deletes the committed Profile as
compensation. While that retry is claimed, `approved` plus the existing
`createdAgentProfileId` means **Finishing setup**, not **Creating Agent**.
Core checkpoints the committed ID on the fenced `approved` request immediately
after Auth returns and before starting Space, Binding, working-folder, or
Default Project setup. A stale-attempt recovery therefore cannot relabel a
known committed identity as a creation failure.

Before Auth creates the Agent Profile identity, Core revalidates the selected
local-agent candidate against the target member's current Computer projection.
If that exact candidate is missing, stale, or not connectable, the request fails
with no `createdAgentProfileId`. Web, CLI, Local Agents, and the Center Agent do
not create the Auth Profile first and then discover that the selected Computer
cannot be used.

When one Computer reports the same Agent Controller from multiple runtime
lanes or OpenMeld Service Runtime identities, the Organization Computer
projection selects one complete newest execution-target record before removing
private fields. It must not combine readiness from one lane with ACI details,
version, or controller identity from another. At the same observation time, a
complete non-ready record wins over a ready record so ambiguous evidence fails
closed instead of reviving an older runnable state.

Approval authorizes the request's complete frozen creation intent. Core still
uses the existing owner contracts for each operation: Auth creates the Agent
Profile identity, Space membership uses the normal Space mutation, and Binding
and Default Project use their existing Core-owned operations. The request state
machine coordinates those operations; it does not create parallel mutation or
authorization paths.

The creation-request executor completes `new`, `resume`, and provider-native
`fork`. Resume binds the selected native Session. Fork asks the selected local
controller to create one native child, records that child as OpenMeld-origin,
and binds the child while leaving the source Session unchanged. The request ID
is the durable Fork operation key: a retry may replay the recorded child but
must never ask the provider to create a second child after an uncertain
outcome. New OpenMeld-created child titles use `OpenMeld · <Profile name>`;
later provider title changes remain native Session truth. Clients must not
silently fall back to `new`.

Creation surfaces return one explicit outcome for the committed Profile and
each requested follow-up. When creation includes a Space, the executor adds the
committed Profile to that Space before optional local setup so a temporary
Computer or Agent Controller failure cannot leave a hidden Profile outside the
Space. Any failed follow-up stays visible as a precise recovery issue against
the already-created Profile, and retry continues setup without creating a
second identity.

Human Profiles and the Center Agent use deterministic Dither artwork derived
from their stable Profile kind and Profile ID. A Human Profile's uploaded image
remains authoritative. The Center Agent always uses its Dither identity instead
of an ordinary Agent Controller logo or an uploaded image. Names, owners,
Organizations, Bindings, and Agent Controller references must not change these
generated identities.

A manually operated Agent Profile can be useful even when it is not bound to a
local agent, because a human or assistant may choose that profile explicitly in
CLI operations to represent an AI teammate. An unbound Agent Profile should not
be presented as wakeable. A wakeable local Agent Profile needs a Binding to a
local OpenMeld Service Runtime and Agent Controller before a Space Wake can run it
automatically.

When the Center Agent creates and connects an ordinary workstation Agent
Profile for an Organization task, the new Profile is created in that
Organization and may be added only to Spaces in that Organization. Delegated
creation does not make the Profile portable and does not create a second Wake
authorization fact.

Keep the boundary simple:

```text
Agent Profile = AI teammate identity
Runtime / OpenMeld Service / controller = local execution infrastructure
Human Profile = signed-in user identity
```

If this boundary is blurred, a UI can make a local system look like an available
teammate even when the Agent Profile cannot actually reply in the current Space.

## Collaboration And Execution Connection

Space membership means the Agent Profile participates in a Space's collaboration
model.

It can make the Agent Profile visible, addressable, and available as a
conversation participant. It does not prove the Agent Profile can reply now.

An ordinary human-owned Agent Profile joins an ordinary Space together with its
authoritative owner Human Profile. This is one atomic Core-resolved membership
operation, not a client convention. The owner remains a member after the Agent
is removed and cannot leave while that Agent remains. An unconverted
one-Human/one-Agent Direct Message is the exception: the Agent owner's Human
Profile is a derived read-only observer until that owner explicitly joins and
irreversibly converts the DM into an ordinary Space. Managed Agents, including
the Center Agent, do not use this owner-participation rule. The full membership,
negative-surface, and reconciliation contract belongs to
`developing/product/space-collaboration.md`.

Agent Profile Binding is the execution connection from an Agent Profile to a
local OpenMeld Service Runtime and Agent Controller:

```text
Agent Profile -> Binding -> openMeldServiceRuntimeId + agentControllerRef + optional agentControllerConversationId + controller-native settings
```

The Agent Profile stores identity and instructions. The OpenMeld Service Runtime
stores machine identity and observed Agent Controller availability. Binding
connects them for execution.

Agent Controller Interface (ACI) is local execution infrastructure. It may
describe a controller's selected install, version, sign-in status, native
capabilities, models, skills, and diagnostics on the user's computer. ACI
evidence can help owners understand and repair a Binding, but it is not Agent
Profile identity and must not replace Binding truth, Space membership, or final
Wake readiness.

`agentControllerConversationId` is the private local conversation ID used by the
Agent Controller behind this Agent Profile. It belongs to the Agent Profile, not
to one Space. If one Agent Profile is invited into multiple Spaces, it still
continues the same private controller conversation. Users who need separate
private memory should create separate Agent Profiles. Two different Agent
Profiles must not share one controller conversation. If duplicate ownership is
observed, the system must reject or ignore the conflicting write and fail closed
until the Binding or local Agent Context is repaired.
The Binding writer is the final atomic authority for this rule. Its conditional
insert, and the disable-plus-insert transaction used by reconnect, must claim a
controller conversation only when no other enabled Agent Profile owns it. A
read-before-write availability check improves the response but cannot reserve a
conversation. The writer rejects a new conflicting claim without rewriting or
silently disabling historical duplicate Bindings; those remain explicit repair
state for the Binding owner.

Agent Controller Permission Mode is the per-profile controller permission intent
stored on the Binding. It tells OpenMeld how to launch the selected Agent Controller
for this Agent Profile using the controller's native permission model. Claude
Code uses its `--permission-mode` values (`default`, `acceptEdits`, `plan`,
`auto`, `dontAsk`, `bypassPermissions`). Codex uses its own permission modes
(`Ask for approval`, `Approve for me`, `Full access`, and
`Custom (config.toml)`) backed by sandbox, approval, and config settings. The
labels and execution flags must stay controller-native, because Claude Code,
Codex, Grok Build, and future controllers use different permission names and
enforcement models. Grok Build uses its native `default`, `acceptEdits`, `plan`,
`auto`, `dontAsk`, and `bypassPermissions` modes. Plan remains a controller
execution mode, not proof of a filesystem boundary.

Owners may edit Binding-level runtime settings while a Wake is running. The
accepted Binding id and configuration revision remain the dispatch's immutable
starting identity, so changing model, reasoning, collaboration, or
controller-specific structured permission data never rewrites that accepted
execution. Agent Controller Permission Mode is the narrow
capability-driven exception: after Core saves the Binding and the local
OpenMeld Service receives the canonical route-catalog update, the Service may
apply the new mode to an active controller session only when that adapter
explicitly acknowledges a native live update. The effect begins with later tool
requests; it never retroactively answers a permission request that is already
waiting. Unsupported controllers and launch-only modes keep the active
session's starting mode, while new work waits until the Service has applied the
saved revision before it starts. Product surfaces must distinguish **saved**
from **applied** and must not claim that a particular active session changed
without capability acknowledgement. Pending route-catalog or readiness
convergence after an accepted Binding write must not turn that saved write into
a visible failure. Web shows the saved outcome, refreshes canonical Core
readiness, and lets that readiness projection decide whether the Agent Profile
is Available, Checking, Offline, or Unavailable.
Changing or unbinding the Agent Controller and changing the local working folder
are different because they change the execution target underneath future work
and can interrupt an accepted Wake. Every maintenance surface must read the
owner-sharded RuntimeCoordinator execution state, independent of the current
Space. That read is advisory: before committing one of these changes, the writer
must acquire a short-lived owner-shard execution-target mutation admission and
hold it across the D1 or local Service mutation. RuntimeCoordinator serializes
that admission with new Wake-head acceptance in the same Durable Object storage
transaction, so a Wake that arrives after admission waits instead of racing the
execution-target change. An active execution blocks only the disruptive
mutation; a missing, rebuilding, or unreadable execution-state authority fails
closed for that mutation without blocking model, reasoning, collaboration,
permission, or OpenCode permission writes. A local mutation timeout or invalid
response has an unknown outcome, so Core keeps the admission until its lease
expires instead of admitting a Wake while a late local write may still land.
Expired mutation admission is recoverable after a writer crash or unknown
outcome, so an abandoned change cannot lock the Agent Profile forever.

RuntimeCoordinator maintains bounded per-profile active references and a
generation-bound active-profile projection for this decision. On upgrade, or
when a ready projection is inconsistent with its per-profile record, it rebuilds
them in bounded pages from canonical head and execution authority records rather
than trusting the legacy activity indexes. Reference overflow fails closed
without allowing the stored arrays to grow without limit. The mutation stays
unavailable until repair completes, collection and page-apply failures retry
with backoff, and completed repair makes later reads independent of total
account history. Active-reference writes remain atomic with their canonical
authority writes, so a missing or partial legacy index cannot produce a false
inactive result.
The Agents home may group multiple eligible reconnect actions behind one explicit
confirmation, but each Agent Profile still receives its own authoritative
Binding write and outcome. A Computer or service reconnect must never move
Bindings implicitly, and a bulk reconnect must never guess from a computer name
or include a profile whose matching local controller is not runnable now. A
runtime reconnect preserves the Binding settings that are current when Core
accepts the write. Reconnect clients must omit controller settings instead of
replaying a previously read Binding snapshot; only an explicit settings edit
may carry those fields and its expected `configurationRevision`. The D1 writer
uses that revision as a compare-and-set fence and re-reads before a bounded
retry when a settings write wins the race. Reconnecting must never overwrite a
newer permission, model, reasoning, collaboration, conversation, or OpenCode
permission choice.

An explicit settings edit is successful only when the fresh Binding projection
contains the requested value. A changed value must be fenced by both the
Binding id and `configurationRevision` that the writer read, and the D1 update
must change that row. If a Service reconnect or another settings edit replaces
that write target, Core returns a settings conflict instead of accepting the
new Binding's unchanged value. Web clients also compare an accepted response
with the requested permission, collaboration, model/reasoning, or OpenCode
permission before showing “Settings saved.”

The Agent Profile's authoritative `ownerUserId` is also the Binding owner and
RuntimeCoordinator shard owner. An administrator acting within the Profile's
canonical Organization remains the action and audit actor and must not become a
second Binding owner. A write that discovers an older enabled Binding for the
same Agent Profile under another owner must acquire mutation admission from
every affected owner shard before changing the Binding. Disabling admitted
legacy Bindings and installing the Profile owner's target are one atomic D1
write; any failed step leaves the previous enabled Bindings intact. Unavailable
admission or an incomplete reconciliation fails closed. The D1 write boundary
rejects a new or re-enabled primary Binding when its owner is not the Profile
owner or another enabled primary Binding already exists for that Profile. The
migration keeps pre-existing noncanonical rows available for explicit
reconciliation instead of rewriting ownership silently. Profile-wide
reconciliation inventory is bounded; an over-limit profile requires operator
review before any admission or Binding write begins. None of these Binding
repair rules can move or reuse the Agent Profile outside its canonical
Organization.

Codex Collaboration Mode is a separate per-profile Binding setting. `Default`
starts an ordinary implementation turn. `Plan` starts Codex App Server with
its native Plan collaboration-mode preset, so Codex can investigate, produce a
plan, and ask structured questions without making implementation changes. Plan
does not grant or deny filesystem or command access: the selected Codex
Permission Mode remains independently authoritative for any native permission
request that can occur in that turn. After review, the owner switches the
Binding back to `Default` to continue implementation in the same private
controller conversation.

Cursor uses five controller-native presets over its ACP interface:

- **Default** uses Cursor's standard `agent` mode and standard permissions;
- **Plan** uses Cursor's read-only `plan` mode;
- **Ask** uses Cursor's no-edit, no-command `ask` mode;
- **Auto-review (Smart Auto)** launches `cursor-agent --auto-review acp`;
- **Run Everything** launches `cursor-agent --force acp`, requires explicit
  confirmation, and still respects explicit Cursor deny rules.

When a running Codex, Claude Code, Grok Build, Cursor, or OpenCode turn asks for permission,
asks a structured question, or finishes a plan that needs review, OpenMeld
pauses that same Wake and presents the request in its Space. The Binding owner
can answer there without opening the controller's terminal. OpenMeld returns
the answer to the same provider turn; it does not start a replacement Wake or
resume through a second controller conversation.

The controller's native mode still decides which requests occur and which
choices are valid. OpenMeld does not turn `Ask`, `Plan`, or an approval mode into
one generic permission policy. It maps only the choices the controller offers,
never fabricates an approval, and never upgrades a one-time decision into a
persistent rule without a separate explicit choice from the owner. When the
owner chooses both, OpenMeld answers the current request first so the Wake can
resume, then saves the controller-native low-interruption mode as a non-blocking
follow-up. A failed Profile save must not undo or delay the accepted current
response. Cursor Run Everything keeps its native one-time automatic allow
behavior rather than pausing for an approval that the selected mode already
resolved.

A dispatch-scoped first-party OpenMeld Space Action is not a general controller
command approval. OpenMeld may make its own `reply`, `status`, and `stay_silent`
tools approval-free because they can write only one validated proposal for the
current dispatch and still require RuntimeCoordinator publication. OpenMeld
must not extend that exception to shell strings, arbitrary `openmeld` commands,
filesystem access, network access, or another dispatch. `Ask for approval`
therefore remains authoritative for ordinary Codex actions without blocking the
Agent's chosen Space outcome.

Only the Binding owner may see request details or answer. Other authenticated
Space members may see that the Agent Profile is waiting for its owner, but not
the command, path, plan, question, options, or response. Refreshing the browser
or temporarily losing the Service socket must not lose an unresolved request.
Stop cancels the active provider turn and the pending request. An unanswered
request expires instead of granting access or waiting forever.

Agent Controller Permission Mode is not Space permission, profile identity,
readiness, or RuntimeCoordinator execution truth. Changing it does not make a
profile wakeable by itself. It only changes what the local controller process is
allowed to do once a valid Wake reaches this Binding.

A repair turn must not silently change that saved choice or leave the current
controller conversation in a different permission mode. When a controller
supports a native conversation fork, temporary repair constraints run only on
that child and the next ordinary Wake continues the canonical conversation with
the Binding-selected mode. When no proven fork exists, repair keeps the exact
selected mode and must fail explicitly if temporary settings would otherwise be
required. Repair also fails explicitly if the existing controller conversation
is missing; it never substitutes a new conversation while claiming to continue
the old one. The same rule applies to OpenCode's Binding-owned permission JSON.

The optional Computer file access boundary is separate account-owned local
policy. For an OpenMeld-started run, effective filesystem access is the
intersection of this Computer-wide boundary and the Agent Profile's
controller-native permission mode. Neither setting can widen the other. Agent
Profile UI must not copy the Computer policy or offer a profile-level override;
the current Computer detail is its one management home. Direct user-launched
controller sessions remain governed by the controller's own settings.

Grok Build's current controller sandbox is too coarse to prove
`only_selected_folders` or `block_selected_folders`. Its adapter therefore
reports the Computer file access boundary as unsupported and uses the existing
owner-only run-once-or-cancel interaction. Product surfaces must not describe
Grok Plan, Grok hooks, or a successful ACP launch as enforcement evidence.

Codex Collaboration Mode is likewise not permission, readiness, or execution
truth. It selects how Codex conducts the turn; it must never be inferred from,
or silently rewrite, Agent Controller Permission Mode.

OpenCode does not use the Agent Controller Permission Mode enum. OpenCode exposes
its own official permission JSON through `OPENCODE_PERMISSION`. OpenMeld stores
that official JSON on OpenCode Bindings as OpenCode permissions and passes it to
the local OpenCode process without translating it into Codex or Claude Code
permission modes. Product UI may offer common OpenCode keys such as file edits,
shell commands, URL fetches, web search, and outside-project-folder access, plus
advanced JSON for OpenCode pattern rules. Unsupported controllers must not
receive or display OpenCode permissions.

When Codex, Claude Code, Grok Build, Cursor, OpenCode, or another controller blocks an action under
its configured permissions, product surfaces must name the Agent Profile's
permission settings as the cause instead of presenting a generic command
failure. Recovery links to that Agent in the first-level Agents home and warns
the user to choose a less restrictive mode only when they trust the access it
grants. OpenMeld must never loosen permissions automatically.

Keep these product facts separate:

```text
Space membership does not make Wakeability `Available`.
Binding existence does not make Wakeability `Available`.
Agent Controller Permission Mode does not make Wakeability `Available`.
Codex Collaboration Mode does not equal Agent Controller Permission Mode.
Space Thread placement does not equal Agent Controller conversation continuity.
```

A Binding can make execution possible, but it is only one input to the final
reply path. The product should keep the execution connection explicit and avoid
implicit routing assumptions.

Detailed Space collaboration belongs in
`developing/product/space-collaboration.md`. Detailed transport and claim
eligibility belong in `developing/architecture/agent-transport-contract.md`.

## Working Folder Configuration And Default Project

A local Agent Profile has a device-scoped working-folder configuration with
exactly two wire modes. The existing schema field is `workspaceMode`; this
compatibility name refers to a profile's local working folder and must not be
confused with **Workspace**, the Web presentation term for the selected
Organization context.

- `openmeld_managed`: OpenMeld resolves and maintains the profile's managed
  working directory on that computer. No custom path is stored in the mode.
- `custom`: the current computer stores and validates one explicit absolute
  working directory for the profile.

Working-folder mode and its resolved path are local execution facts. They are
scoped to the current device and OpenMeld lane, may appear in owner-self
diagnostics, and must not become public Agent Profile identity,
Organization-shared data, Agent Activity, snapshot data, or Center Agent
context. A missing or invalid custom folder fails closed; it does not silently
become `openmeld_managed`.

The working folder may be read or changed only while the Profile's canonical
Organization is the active Workspace. Switching Workspaces never makes another
Workspace's Agent Profile or its local execution configuration manageable.

When the exact current Service advertises Local Folder Picker, a custom working
folder uses **Choose folder on this computer** as the primary input action. The
native chooser returns one folder because an Agent Profile has one working
folder. Selection fills the local settings draft; **Create agent** or **Save
changes** remains the explicit mutation through the existing profile workspace
writer. **Enter path manually** remains available as the final fallback. The
picker must not create a second profile workspace store or upload the selected
path into cloud Profile identity.

When the user chooses a custom working folder during Agent creation, Web may
keep the private path only in the existing account-scoped, per-tab local
settings draft. The draft is keyed to the creation request and is bound to the
committed Profile ID when one exists. It is never sent to Core or treated as
current working-folder truth, and is cleared only after the current OpenMeld
Service accepts the workspace mutation. Web may persist a separate
browser-local marker without the absolute path: before identity commit it
records only that custom setup is due, and after commit it may contain the
Profile ID. This marker prevents a closed tab from turning unfinished
custom-folder setup into apparent success. **Retry setup** finishes the fenced
Core request first and then retries that local draft against the same Profile.
If only the marker remains, the user must choose the custom folder again in
Agent settings; OpenMeld must not infer it or silently keep `openmeld_managed`
as if the custom choice succeeded. A successful explicit working-folder choice
in Agent settings clears all remaining setup drafts and markers for that Profile
so the request returns to its completed presentation.

When the Default Project selector needs a new local Project connection, it
reuses the same Project connection flow and offers **Choose a Project folder on
this computer**. Selection fills the Project connection draft; **Connect**
remains the Project-control mutation, and only the resulting validated
connection may become the profile's Default Project working folder.

`defaultProjectId` is a separate Organization-scoped cloud preference for a
local Agent Profile. It identifies the Project that future Wakes and new
sessions should use by default. It does not store a folder, permanently assign
the profile to a Project, or move the profile's current controller session.
Remote Agent and Center Agent Profiles do not show or use this field in the
MVP.

The current computer resolves Project intent through its own local state:

```text
defaultProjectId
-> default Local Project Connection on this computer
-> working folder
```

Local execution, readiness, diagnostics, and CLI Profile presentation consume
this same effective working-folder resolution. They must not independently
re-resolve a Profile workspace and report an OpenMeld-managed folder while
dispatch is using the Default Project connection.

If the Project has no usable default connection on that computer, Wake fails
explicitly. The resolver must not choose another worktree, another Project, or
the OpenMeld-managed workspace. Choosing **Let OpenMeld choose** is an explicit
user action that clears or replaces Project intent through the owning product
flow; it is never a failure fallback. Product copy must use this plain-language
label instead of exposing the internal `openmeld_managed` term.

Agent Profile creation presents one **Working folder** selector. Active
Projects appear first, with the Project name and the current computer's path
when available. **Let OpenMeld choose** and **Choose a folder on this
computer…** follow the Project choices. The UI does not designate any of these
choices as recommended, and it reveals custom-folder controls only after the
custom choice is selected.

After a local Agent Profile is created and its local Binding setup succeeds,
OpenMeld remembers that user's selected Default Project, model, reasoning
effort, Agent Controller Permission Mode, Agent Controller Collaboration Mode,
and controller-specific permission settings for the same Organization and
Agent Controller. These creation defaults are keyed by Organization, user, and
canonical Agent Controller ref; they are not Agent Profile identity or Binding
truth. Web, CLI, Local Agents, and the Center Agent read and write this same
Core-owned preference contract. The stored Default Project is a cloud Project
id, never a local path. Custom and OpenMeld-chosen paths therefore save no
Default Project id.

Those four creation surfaces also submit the same shared creation-selection
contract for Default Project, model, reasoning effort, Agent Controller
Permission Mode, Agent Controller Collaboration Mode, and controller-specific
permissions. A client may present those fields differently, but it must not own
a smaller private settings model or write the same choice through a second
state path. Core applies the shared selection to the Binding, reuses the
existing Default Project mutation, and writes remembered creation defaults
only after the usable local Agent Profile setup succeeds.

The next creation may prefill only values that remain valid in the current
Project list and current Agent Controller catalog. Missing or archived Projects,
removed models, unsupported reasoning levels, and unsupported permission modes
fall back to current defaults rather than leaking stale configuration or a
different Agent Controller's choices. Failed or cancelled creation does not
replace the remembered values, and dangerous permission confirmations are
never remembered as approved.

Web may also keep an unfinished creation journey as a browser-local draft so a
member can leave the flow and return without rebuilding ordinary selections.
This draft is scoped by Organization and user, is advisory rather than
authoritative, and may contain only the selected Agent Controller, supported
model and reasoning choice, supported controller settings, and a cloud Project
id. It never stores a custom absolute folder path or a dangerous-permission
confirmation. Web restores the draft only after validating every value against
the current local-agent catalog, model catalog, permission options, and Project
list; otherwise it discards the stale draft and uses current defaults. A
successful creation clears the journey draft. Restoring or abandoning this
browser draft never writes or replaces the Core-owned remembered creation
defaults. Once the member changes the selected local Agent or execution target,
that direct choice ends draft restoration for the current open creation flow;
later renders must not restore an older choice over the member's input.

The Center Agent can read every saved controller-specific row for the
represented member before creating a local Agent Profile. These values are
concrete user preferences, not a rules engine or a forced configuration: the
Center Agent keeps them when they fit the task, changes them when the task needs
different capability, and asks the member when an important choice remains
uncertain. The projection contains Project ids only. Local folder paths stay in
the Local Project Connection owned by the current OpenMeld Service.

Changing Default Project or the local default connection applies only to
future Wakes and new sessions. Product copy must say that the current session
will not be moved. Project identity, local connection invariants, and public
failure semantics belong to `developing/product/projects.md`.

## Agent Profile Work Coordinator

The Agent Profile Work Coordinator is the workstation-only admission and FIFO
owner for work sent to one ordinary Agent Profile. Remote Agents and the hosted
Center Agent do not use this state machine or execution chain.

For one Agent Profile, the Coordinator owns exactly these facts:

- which accepted Wake currently owns the Profile's work slot
- the ordered Wakes waiting behind it
- whether queued work is held for an explicit recovery approval
- the current privacy-safe workload projection

RuntimeCoordinator still owns whether the current Wake is accepted, running,
stopped, failed, or terminal. The Space outbox still owns the complete Wake
payload. Agent Activity still owns provider-observed coding-session awareness.
The Coordinator must not duplicate any of those truths.

Before a fresh workstation Wake can become the current or a queued Work
Coordinator item, Core consumes the canonical Wakeability projection for that
Profile. The current compatibility API and schema call this projection
`AgentExecutionReadiness`; that name does not define a second product concept.
A blocking current fact rejects the Wake before Coordinator
admission and produces a visible no-execution outcome with one recovery action.
In particular, disabling the selected Local Agent means no new work: rejected
Wakes are not retained as a hidden backlog that can start after the Local Agent
is enabled again.

Every accepted head is checked again immediately before local execution. This
check uses current Profile access, Binding, controller and configuration,
workspace, Local Agent enabled state, and canonical availability rather than
the facts captured when the Wake first entered FIFO. If a promoted or redriven
head is now blocked, RuntimeCoordinator records a durable terminal no-execution
outcome for that exact head and the Work Coordinator continues normal terminal
promotion. Reconnect, recovery, or later re-enabling cannot revive that settled
Wake.

One Agent Profile may have one current Wake and at most 50 waiting Wakes. FIFO
order is the owner-shard transaction acceptance order across every Space and
Direct Message that targets that Profile. There is no priority system in this
version. A source message is visible in its conversation immediately; its Wake
may show that it is queued, but Web does not hide or stack the message above the
Composer until execution starts. Different Agent Profiles remain independently
admissible and may work in parallel.

The first accepted Wake request remains frozen while it waits, moves to the
front, or is redriven after transport recovery. Prompt, attachments, source
message, reply destination, target Profile, Binding/configuration revision, and
execution identity belong to that Wake. A refreshed queue timestamp, recovery
reason, or later display-name snapshot does not create a different request. A
real immutable-content mismatch fails that exact pre-execution Wake visibly, or
stays retryable if RuntimeCoordinator cannot safely settle it; it is never
treated as a duplicate, a Computer-offline verdict, or permission to execute
the changed content.

`Queued` means another Wake owns this Profile's work slot. It is not the
existing RuntimeCoordinator `waiting` state used after a Wake reaches the head
but is waiting for an OpenMeld Service route. Normal queue time has no fixed
failure deadline. A terminal current Wake promotes the next queued Wake
immediately; an alarm repairs only a crashed or failed promotion and is not the
normal scheduler.

Space Wake progress may say that a Wake is `queued` only when the Agent Profile
Work Coordinator head lifecycle confirms that it is waiting behind another
Wake. A Space outbox handoff, Dispatch lookup, or RuntimeCoordinator
`created`/`delivery_pending` status alone stays neutral as a sent request; none
of those facts proves Profile FIFO waiting.

The current Wake may also wait because the official Local Agent has given a
different process exclusive writer ownership of the exact Agent Controller
conversation. That Wake remains current, later Wakes remain behind it, and no
Wake failure is published. OpenMeld retries immediately after an official
provider release signal; an alarm is only a recovery backstop. This fact comes
from provider admission, never from Agent Activity, process presence, or a
guess based on recent output.

Usage participates in Wakeability only when the Local Agent exposes structured,
reliable Usage Limits. A Local Agent that explicitly reports Usage as
unsupported, or that has no reliable Usage capability because reporting is
passive or not evaluated, does not use Usage as an admission condition. Once a
Local Agent's versioned capability matrix declares native Usage support, a
missing, stale, expired, or currently unavailable observation projects
`Checking` and rejects a new Wake; OpenMeld must not promise acceptance while
the required fact is unknown. During a mixed-version rollout, a legacy Local
Agent that does not declare its Usage support-matrix version remains outside
this admission condition; a newer Core must not reinterpret that omission as
`Checking`. A
fresh exhausted Usage Limit projects `Unavailable` and blocks the Wake before
admission. These decisions use the current report already held by Core and must
not add a provider call to the Wake hot path. Core and the Local Service consume
the same matrix from `@openmeld/agent-runtime`; a Local Agent upgrade changes
this behavior only through one reviewed matrix update backed by official
provider evidence and a real smoke test.

A structured Wake failure may update future Usage admission only when the
accepted execution's exact Agent Controller has native Usage support in that
same matrix. A passive, unsupported, or not-evaluated controller may still
report `usage_exhausted` for the current Wake and preserve its raw provider
detail in Message Details, but that result must not create blocking evidence
for a later Wake.

If a running Wake reports a structured `usage_exhausted` outcome, that Wake ends
as a visible failure and the Coordinator holds every later Wake. When fresh
reliable Usage from the exact current support-matrix contract becomes available,
OpenMeld automatically retries the interrupted request at most once as one
deterministic, idempotent new execution. A legacy or mismatched Service report
cannot authorize that retry. OpenMeld does not claim that the terminal provider
turn reopened. After that continuation succeeds, the owner receives the
separate urgent Inbox and email approval for the held queue.
If the user explicitly Stops the continuation, OpenMeld never starts it again;
later queued work still requires the same owner approval, while an empty queue
clears recovery immediately. Wakes submitted after recovery remain behind the
held work and cannot bypass it. A repeated Usage report may safely repair an
incomplete handoff before the continuation starts through the same deterministic
operation; it must never create a second continuation. If the original request
cannot be replayed safely, its source context is incomplete, its Binding or
configuration changed, or the automatic continuation execution fails, the
interrupted work moves to `Needs attention` and cannot enter another automatic
retry loop. A lost or ambiguous Space handoff response is not an execution
failure: OpenMeld keeps the deterministic continuation identity and confirms or
retries that same handoff on a later report.
The owner gets one idempotent Inbox item linked to the original Wake and may
skip that interrupted work to continue FIFO. Reading or dismissing the item does
not skip work. A provider may gain true same-turn recovery only after its
versioned capability has official protocol evidence and a real
failure-to-recovery smoke test.

For Space and Direct Message Wakes, that automatic continuation uses the exact
interrupted dispatch and source message as its internal continuation authority.
The new Wake keeps the original source message's author; the Agent owner's Human
Profile authorizes recovery but is not shown as the original sender.

Owners may keep editing settings while work is queued or running under the
existing capability rules. A running Wake keeps its accepted Binding and
configuration revision. Saved model, reasoning, controller, and launch-only
permission changes apply to future work. A native live permission update is
shown as applied only after the provider acknowledges it.

An approved Usage continuation rechecks its exact Binding, controller, and
configuration revision before it can continue, not only when Usage first
recovers. Continuation authorization, head admission, and every cloud-owned
future-work settings change share one owner-shard ordering boundary. If the
continuation becomes running first, the current Wake keeps its accepted
settings and the saved change applies to later work. If the setting change wins
while the continuation is pending or authorized, the continuation moves to
`Needs attention` without executing. During a rolling deployment, an older
owner shard that cannot coordinate future-work settings rejects that settings
save before changing the Binding; ordinary Wakes keep using the unchanged fast
path.

## Agent Profile Operational Context

Agent Profile Operational Context is the read projection that composes Agent
Profile identity, Wakeability, current workload, applied execution settings,
Usage, and recovery actions. It does not own those facts and cannot decide
execution by itself.

When interrupted work needs attention, the owner projection exposes one direct
`Skip interrupted work` action. The action is idempotent, resolves only the exact
current recovery gate, and promotes the oldest queued Wake. A stale page cannot
skip a later interrupted Wake; it must refresh the current Profile Details
projection first. Non-owners see the neutral workload state without this action
or the interrupted request details.

Owners and other Organization members see the same compact workload summary,
such as `Working · 3 queued`. Profile Details may show the owner where the
current Wake is running and which tasks are queued. Other members see only
neutral workload state and count; they do not receive Space names, task text,
controller conversation identifiers, local paths, or other owner diagnostics.
This projection belongs in the existing Profile Details surface, not a separate
status product.

Organization-member Agent details may also include one explicit public display
configuration: the friendly Agent Controller, model, reasoning level,
collaboration mode, and permission mode already used to identify how the
teammate works. Core projects that allowlisted display object independently of
owner-only readiness diagnostics. It never includes a Computer identity, local
path, controller conversation identifier, runtime identifier, raw provider
account data, or mutation authority. Offline, unavailable, and checking Agents
keep this stable identity and configuration visible; temporary readiness does
not blank the Profile Details surface.

The non-owner readiness projection keeps the public four-state Wakeability
status and may additionally name one exact, structured `usage_exhausted` fact
as **Usage Limit reached**. That fact helps teammates avoid assigning work that
cannot start. It is a narrow allowlist exception, not provider-account access:
the projection still omits provider and account identity, Computer and Space
details, route and Binding evidence, controller and conversation identity, task
content, raw errors, and every owner recovery action. Every other blocking
reason remains the generic public Wakeability state.

An owner read may request up to 100 Profiles and each Profile may expose one
current plus 50 queued work references. Runtime Transport reads those Durable
Object records in explicit batches of at most 128 keys and runs at most four
batch reads concurrently. It then restores the requested Profile and FIFO work
order before applying the same privacy projection. This is a read-only Profile
Details path, never Wake admission work; the storage limits must not become a
user-visible partial result or slow a new Wake.

## Wakeability And Recovery Surfaces

Wakeability may appear on Agent Profile surfaces because users need to know
whether an AI teammate can accept a new Wake now.

The user-facing question is:

```text
Can this Agent accept a new Wake here right now?
```

Agent Profile identity does not own the answer.

Final user-facing Wakeability comes from transport-owned evidence, not from Agent
Profile identity. Route online is not enough. Binding existence is not enough.
Completed Prepare evidence is not enough. Local process health is not enough.
For an Organization Space, readiness must verify that the Agent Profile's
canonical `organizationId` equals the Space's Organization. Missing or
unverifiable Organization identity, or any mismatch, is `Unavailable`, never
`Available`, even when the Binding, Runtime, and route are otherwise
healthy. Legacy authorization records never satisfy or override this check.

Agent Profile surfaces may display `Available` only when the Core-owned
Wakeability projection says the full reply path is aligned for the
target profile, intended account, OpenMeld Service Runtime, Agent Controller, OpenMeld
Service compatibility, and claim eligibility.

Public Wakeability uses four verdicts only: `Available`, `Checking`,
`Offline`, and `Unavailable`. Concrete repair actions such as `Update OpenMeld
on Computer`, `Reconnect Computer`, or `Connect local agent` are owner guidance,
not separate public states.

`Offline` is reserved for stable Computer, OpenMeld Service, or route liveness
loss. A signed-out controller, unavailable provider subscription, organization
access block, or fresh reliable Usage Limit evidence that proves no remaining
Usage is `Unavailable`, with the provider-account next action. That action
reviews the Agent Profile and provider account; it does not send the user
through local-agent reconnect or Prepare. Usage Limit copy names a reset time
only when current authoritative evidence actually provides one. These account
states do not become a red launch error or
`needs_repair`; actual launch verification failure remains a distinct local
setup error.

Agent Profile surfaces must distinguish connection truth from temporary
readiness recovery. When Core classifies a missing or stale local Agent
Controller report as `Checking`, that transient must be bounded and should use
the controller's product name when known. A client may continue a bounded
background refresh, but it must preserve Core's public verdict throughout: it
must not repaint a Core-owned `Offline` or `Unavailable` state as `Checking`.
After the client refresh budget expires, it may offer `Check again` without
changing the public state. It must not relabel an existing Binding as `Connect
local agent`; connection copy and connection actions are reserved for a
genuinely missing Binding.

A temporary Agent Controller check failure is also recovery evidence, not
proof that setup is damaged. When Core reports `check_status` because every
non-ready controller is blocked only by a retryable check failure, Agent
Profile and Space surfaces keep Wake blocked and offer `Check again`. They must
not send the user through setup or reinterpret diagnostic reason codes into a
second recovery verdict. Ready controllers do not change that decision merely
because they carry additional non-blocking diagnostic reason codes.

Concrete blockers name the affected object and place one verb-first action next
to the explanation. For example, `Felix's MacBook Pro is not connected.` uses
`Connect computer`, while `Felix's MacBook Pro needs an update.` uses `Update`.
Primary blocker copy must not collapse a known problem into `needs setup` or
`Review setup`. A healthy Binding may still describe where the profile runs.

Reply recovery answers:

```text
This Agent Profile cannot reply now. What should the user do next?
```

Reply recovery copy may explain an already-known reason and present one clear
next action. It does not own readiness truth, discover truth by itself,
orchestrate setup, manage OpenMeld Service, decide execution truth, decide final Wake
outcome, or place Space replies.

Deleting an Agent Profile retires both its teammate identity and its remaining
execution connection. It is not complete when Auth removes only the Profile
row. The same identity transaction records an Auth-owned durable cleanup item;
the immediate path and the scheduled retry path then ask the Profile owner's
RuntimeCoordinator shard to stop matching accepted, waiting, and in-flight
Wakes. Space membership removal and the exact owner/Profile Binding transition
are separate lifecycle consequences: Core disables the Binding so no future
execution route survives the deleted identity, while Space removes the member
only after cancellation is accepted or RuntimeCoordinator proves that no
matching Wake is active. Auth removes the cleanup item only when Core confirms
the whole lifecycle. A partial or unavailable consequence stays retryable; it
must not leave a removed Agent presented as indefinitely working.

Deletion cleanup is a lifecycle operation, not an ordinary owner edit. It uses
the authoritative owner and deleted Profile identity from the deletion event
and therefore must not revalidate the already deleted Profile row through the
user-command Binding path. The cleanup remains exact-owner, exact-Profile, and
fail-closed so it cannot disable a different member's Binding.

Local agent selection may prepare or update the execution connection, but it
must not merge identity and infrastructure. The Agent Profile remains the AI
teammate identity. The selected local controller or capability remains local
execution infrastructure.

If readiness or local selection fails, the product should use clear user
language and a concrete next action. Internal terms such as runtime, route,
lease, claim, and binding belong in diagnostics, not primary user copy.

Profile Details surfaces may show richer diagnostic facts when the viewer owns
the profile. Those details must keep product identity separate from local
execution infrastructure. Local connection facts such as controller conversation
ID, OpenMeld Service runtime ID, Binding state, and workspace directory are
owner-self diagnostics. They must not be presented as public Space identity,
and observer views must not receive them. Agent Profile settings may show the
friendly controller name and Computer currently providing its runtime, followed
by **Manage on Computer**. Installation selection remains exclusively on that
Computer; Agent Profile settings must not add a second installation selector.
Create and edit surfaces use that Computer's current Agent Controller Interface
model inventory, or a valid catalog version floor when inventory is unavailable,
to prevent a known-incompatible model selection. Unknown evidence remains
selectable. A saved selection that later becomes incompatible stays visible and
must offer the exact Computer as the recovery path; it is never silently replaced.
The computer display name is the one bounded exception: a current Organization
member may see it in the read-only Organization Computers directory. That
exception grants no local diagnostics or computer-management authority.

The Agents home and compact About dialog are two presentations of the same
Profile Details and edit contract, not separate Agent-management systems. The
Agents home renders the selected Agent as persistent detail. Owner-authorized
fields edit from their own anchored card or value; the page must not switch into
a separate all-fields edit mode. Read-only facts such as Owner have no edit
affordance. Each editable field keeps explicit save and cancel actions and reuses
the existing mutations, execution-target locks, permissions, and failure
diagnostics. A failed save preserves that field's draft and error instead of
replacing the whole detail surface or falling back to stale state. Space Members
continues to use the compact About dialog for quick preview. Presentation choice
does not create another Profile, Binding, readiness, request, or edit source of
truth.

## Owner Boundaries

This document owns Agent Profile product semantics only.

Use scoped owner documents for detailed rules:

- `developing/product/space-collaboration.md`: Space collaboration and
  addressing semantics.
- `developing/product/projects.md`: Project identity, local Project
  connections, Default Project resolution, and Project-aware Wake semantics.
- `developing/architecture/agent-transport-contract.md`: readiness, Wake
  execution, and final outcome contract.
- `developing/architecture/local-openmeld-service.md`: local setup, service, account,
  device, lane, and capability alignment.
- `developing/architecture/shared-contracts.md`: shared package and cross-client
  policy boundaries.

## Product Invariants

- An Agent Profile is an AI teammate identity.
- An Agent Profile is not Runtime, computer, OpenMeld Service, controller, or local
  process.
- Space membership does not make Wakeability `Available`.
- Binding is the execution connection from an Agent Profile to an OpenMeld Service
  Runtime and Agent Controller.
- Controller-native permission settings are Binding-level launch intent, not
  Agent Profile identity, Space permission, or readiness truth.
- A pending local-agent request is RuntimeCoordinator execution state, not
  Binding configuration, Space message history, or durable approval truth.
- Binding existence does not make Wakeability `Available`.
- Agent Profile identity does not own readiness truth.
- Working-folder mode is a device-scoped local execution fact with only
  `openmeld_managed` and `custom` states.
- Default Project is an Organization-scoped preference for future local work,
  not a local path or permanent Agent Profile assignment.
- Reply recovery copy does not own readiness truth.
- Local agent selection must not merge Agent Profile identity with local
  execution infrastructure.
