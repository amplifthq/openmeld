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

An Agent Profile name should describe the AI teammate's practical role, not
the Runtime, provider, or Agent Controller behind it. When an assistant creates
an Agent Profile and the user did not supply a name, it should infer a short,
plain name from the user's current goal and Space context, usually two to four
words such as `Release Reviewer`, `API Debugger`, or `Docs Editor`. Bare
infrastructure names such as `Codex`, `Claude`, `Claude Code`, `Cursor`, `Grok Build`, or `OpenCode`,
and vague names such as `Assistant`, `Agent`, or `Helper`, are not meaningful
teammate identities. Preserve an explicit user-provided name. If the available
context does not support a meaningful role, ask for a name before creating the
profile.

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
Project, Organization Wake access, and Space-membership steps must keep that
same Organization id. A mismatch fails before the Profile write instead of
creating an identity in one Organization and configuring it through another.

A successful Agent Profile identity write is the creation commit point. A
client must never report a later Binding, working-folder, Default Project,
Organization Wake access, or Space-membership failure as if Profile creation
failed, because retrying the create would produce a second teammate identity.
Every interactive creation intent carries one stable idempotency key until
Auth returns the committed Agent Profile. An exact retry or concurrent replay
returns that same Profile; it must never create a second identity. Reusing the
key for a different name, Organization, or creator under the same owner fails
with an explicit conflict. A client-side in-flight guard improves immediate
feedback, but Auth's durable idempotency boundary remains authoritative when
rendering, transport, or network retries overlap.

Creation surfaces return one explicit outcome for the committed Profile and
each requested follow-up. When creation starts from a Space, the client adds
the committed Profile to that Space before optional local setup so a temporary
computer or Agent Controller failure cannot leave a hidden Profile outside the
Space. Any failed follow-up stays visible as a precise recovery issue against
the already-created Profile.

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

When the Center Agent creates and connects an Agent Profile for an
Organization task, that configured creation operation must also turn on Wake
access for the active Organization before it adds the profile to the Space.
This is explicit delegated user intent, not the per-user auto-authorization
preference. A failed authorization blocks the configured operation; the product
must not report the profile as ready or leave the Space to discover the missing
access only when the first Wake fails.

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

Owners may edit Binding-level runtime settings while a Wake is running. Saving
must never mutate or invalidate an execution that RuntimeCoordinator already
accepted: that Wake continues with the settings revision it started with. New
work waits until the local OpenMeld Service has applied the saved revision
before it starts. Product surfaces must distinguish **saved** from **applied**
and explain both facts directly; a successful cloud write must not imply that
the local controller changed immediately. The inverse is equally important:
pending route-catalog or readiness convergence after an accepted Binding write
must not turn that saved write into a visible failure. Web shows the saved
outcome, refreshes canonical Core readiness, and lets that readiness projection
decide whether the Agent Profile is Available, Checking, Offline, or Unavailable.
The Agents home may group multiple eligible reconnect actions behind one explicit
confirmation, but each Agent Profile still receives its own authoritative
Binding write and outcome. A Computer or service reconnect must never move
Bindings implicitly, and a bulk reconnect must never guess from a computer name
or include a profile whose matching local controller is not runnable now. A
runtime reconnect preserves the Binding settings that are current when Core
accepts the write. Reconnect clients must omit controller settings instead of
replaying a previously read Binding snapshot; only an explicit settings edit
may carry those fields and its expected `configurationRevision`. Reconnecting
must never overwrite a newer permission, model, reasoning, collaboration,
conversation, or OpenCode permission choice.

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
persistent rule. Cursor Run Everything keeps its native one-time automatic
allow behavior rather than pausing for an approval that the selected mode
already resolved.

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
Space membership does not equal Available for Wake.
Binding existence does not equal Available for Wake.
Agent Controller Permission Mode does not equal Available for Wake.
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

When the exact current Service advertises Local Folder Picker, a custom working
folder uses **Choose folder on this computer** as the primary input action. The
native chooser returns one folder because an Agent Profile has one working
folder. Selection fills the local settings draft; **Create agent** or **Save
changes** remains the explicit mutation through the existing profile workspace
writer. **Enter path manually** remains available as the final fallback. The
picker must not create a second profile workspace store or upload the selected
path into cloud Profile identity.

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
effort, and Agent Controller Permission Mode for the same Organization and
Agent Controller. These creation defaults are keyed by Organization, user, and
canonical Agent Controller ref; they are not Agent Profile identity or Binding
truth. The stored Default Project is a cloud Project id, never a local path.
Custom and OpenMeld-chosen paths therefore save no Default Project id.

The next creation may prefill only values that remain valid in the current
Project list and current Agent Controller catalog. Missing or archived Projects,
removed models, unsupported reasoning levels, and unsupported permission modes
fall back to current defaults rather than leaking stale configuration or a
different Agent Controller's choices. Failed or cancelled creation does not
replace the remembered values, and dangerous permission confirmations are
never remembered as approved.

Changing Default Project or the local default connection applies only to
future Wakes and new sessions. Product copy must say that the current session
will not be moved. Project identity, local connection invariants, and public
failure semantics belong to `developing/product/projects.md`.

## Readiness And Recovery Surfaces

Readiness may appear on Agent Profile surfaces because users need to know
whether an AI teammate can reply now.

The user-facing question is:

```text
Can this Agent Profile reply from this computer in this Space right now?
```

Agent Profile identity does not own the answer.

Final user-facing readiness comes from transport-owned evidence, not from Agent
Profile identity. Route online is not enough. Binding existence is not enough.
Completed Prepare evidence is not enough. Local process health is not enough.
For an Organization Space, readiness must also verify that the active
Organization has Wake access to the current primary Binding. Missing or
unverifiable Organization Wake access is `Unavailable`, never `Available for
Wake`, even when the Binding, Runtime, and route are otherwise healthy.

Agent Profile surfaces may display `Available for Wake` only when the
Core-owned readiness projection says the full reply path is aligned for the
target profile, intended account, OpenMeld Service Runtime, Agent Controller, OpenMeld
Service compatibility, and claim eligibility.

Public availability uses four states only: `Available for Wake`, `Checking`,
`Offline`, and `Unavailable`. Concrete repair actions such as `Update OpenMeld
Service`, `Reconnect OpenMeld Service`, or `Connect local agent` are owner guidance,
not separate public states.

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

Concrete setup failures name the controller and computer, such as `OpenCode
needs setup on Felix's MacBook Pro`, while a healthy Binding describes where the
profile runs.

Reply recovery answers:

```text
This Agent Profile cannot reply now. What should the user do next?
```

Reply recovery copy may explain an already-known reason and present one clear
next action. It does not own readiness truth, discover truth by itself,
orchestrate setup, manage OpenMeld Service, decide execution truth, decide final Wake
outcome, or place Space replies.

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
The computer display name is the one bounded exception: a current Organization
member may see it in the read-only Organization Computers directory. That
exception grants no local diagnostics or computer-management authority.

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
- Space membership does not equal `Available for Wake`.
- Binding is the execution connection from an Agent Profile to an OpenMeld Service
  Runtime and Agent Controller.
- Controller-native permission settings are Binding-level launch intent, not
  Agent Profile identity, Space permission, or readiness truth.
- A pending local-agent request is RuntimeCoordinator execution state, not
  Binding configuration, Space message history, or durable approval truth.
- Binding existence does not equal `Available for Wake`.
- Agent Profile identity does not own readiness truth.
- Working-folder mode is a device-scoped local execution fact with only
  `openmeld_managed` and `custom` states.
- Default Project is an Organization-scoped preference for future local work,
  not a local path or permanent Agent Profile assignment.
- Reply recovery copy does not own readiness truth.
- Local agent selection must not merge Agent Profile identity with local
  execution infrastructure.
