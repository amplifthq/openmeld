# Agent Profiles

## Agent Context

- Purpose: Define Agent Profile identity, Binding, controller settings, membership, and reply recovery.
- Read this when: Changing Agent Profiles, local-agent selection, workspace preferences, readiness, or connection behavior.
- Update this when: Agent Profile ownership, lifecycle, or controller semantics change.
- Do not use this for: Runtime execution authority, Service lifecycle, Space thread mechanics, or implementation runbooks.
- Source of truth: This document owns durable Agent Profile product semantics.

## Shared provider conversations

A controller with `conversationScope: account_shared` connects an existing
provider conversation to an ordinary Agent Profile. The owner supplies the exact
conversation ID and acknowledges shared messages and conversation-wide Stop once
when connecting. Grok Bot uses this contract through the official BDK account.
The existing Profile, membership, DM, Space Wake, queue, Stop and diagnostics
surfaces remain the product entrances. No separate Bot identity is created.

Model, reasoning, permissions, tools and working directory remain managed by the
provider. Creation hides these controls and rejects their configuration in the
shared request contract. Fork, independent contexts and Activity-session import
are unavailable. A direct Binding write must include the existing conversation
ID and shared-control acknowledgment. Reconnecting the same Profile and controller
can omit both fields to retain its already confirmed conversation. Core rejects
this form when no existing conversation exists. Changing the conversation still
requires its ID and acknowledgment. The generic controller switcher excludes
shared-conversation controllers because it cannot collect that connection.
The switcher is offered only for unassigned Profiles, as their assignment
action; an Agent Profile that belongs to a MemberAgent cannot change harness
(see MemberAgent Layer).

Connection confirmation: “Shares your Grok Bot conversation. Stopping here stops
the bot’s current work.” Actions: **Connect bot**, **Cancel**. Ordinary sends do
not repeat this confirmation. Use the Bot's conversation ID from BDK; resolving
a name through get-or-create is not a connection operation.

## MemberAgent Layer

Implementation status: shipped. The MemberAgent program (PR #236) is merged,
and `MEMBER_AGENTS_ENABLED` is on.

Member-owned Agents are organized in three persisted layers, each with one job:

```text
MemberAgent (organization × owner × harnessKind)  whose harness
-> Agent Profile                                  which configuration
   -> Session                                     what is happening now
```

| User-facing | Code | Meaning |
| --- | --- | --- |
| Agent | **MemberAgent** (`member_agents`) | One Organization member's instance of one harness, for example `Felix Lu's Claude Code` |
| Claude Code, Codex, … | **Harness** (`harnessKind`) | The program kind that runs an Agent: `claude-code`, `codex`, `grok-build`, `cursor`, `opencode`, `antigravity`, `openclaw`, `hosted` |
| Profile | Agent Profile | One configuration; still the Space member, message author, and mention target |
| Chat | Session | One conversation: a Direct Message Space, or an Execution Context inside a group Space |

`harnessKind` maps one-to-one from the Binding's `agentControllerRef`; Agent
Controller remains the code name for that ref. Banned names for these
concepts are listed in `developing/product/organizations-and-center-agent.md`,
Vocabulary Seeds.

A MemberAgent is unique per `(organizationId, ownerUserId, harnessKind)` and
lives in Auth beside Agent Profiles. It records its `defaultProfileId`,
`source`, and `archivedAt`; a Profile names its parent through a nullable
`memberAgentId`. Migration sets `defaultProfileId` to the most recently used
Profile of the group. The MemberAgent stores no status. Presence and state
are derived at read time from its Profiles' Wakeability and their Computers'
online state. A harness reads as missing on every Computer only after it has
been absent from several consecutive catalog reports or for several minutes,
so a PATH hiccup or an upgrade never greys the Agent. The display name
`Felix Lu's Claude Code` is derived by the client from the owner's default
Human Profile name and the harness display name. It is English only and never
stored.

A MemberAgent exists only for a harness the member chose. Setup creates one
for each local agent the member selected (`--local-agent`, or the agents
chosen on the Connect page), and `openmeld agent add <harness>` or the web add
action creates one later. Each of these sends the harnesses to create to the
catalog sync, and Core creates a MemberAgent only for a requested harness that
the OpenMeld Service's harness catalog report shows on a connected Computer.
Core asks Auth to create the MemberAgent and its default Agent Profile with the
deterministic idempotency key `auto:{organizationId}:{harnessKind}`; the
conditional insert on the unique key makes two Computers converge on one
MemberAgent. Core then writes the Binding and assigns the default Profile under
the same lock as every other assignment, and opens the owner's Direct Message.
A sync without requested harnesses (surface open, catalog update) never
creates a local MemberAgent: it finishes interrupted creations, repairs unassigned
bound Profiles, and reports the other detected harnesses as addable.
MemberAgent `source` is `detected`, `migrated`, or `manual`; a detected Agent's
default Profile's `source` is `auto_detected`.

Personal Remote Agents are MemberAgents with `harnessKind = hosted` and
`source = manual`. The first accepted hosted Binding atomically creates this
MemberAgent, assigns its Profile, and selects that Profile as the default.
Later hosted Profiles join the same MemberAgent without replacing its default;
catalog sync also repairs a hosted assignment interrupted after the Binding
was accepted, without requiring a connected Computer.
The Organization-owned Center Agent has no owner and stays
outside this structure. Two kinds of Profile cannot be grouped and stay
unassigned: Profiles that never bound and Profiles bound to a `custom`
controller. A disabled Binding still groups by its last Binding's harness and
reads as missing. Unassigned Profiles sit in their own section at the bottom of
the Agents list, with the controller switcher as their assignment action. The
system never guesses an assignment.

The MemberAgent list and presence are owner reads. A MemberAgent link
(`/agents?memberAgentId=`) still opens for any member of its Organization:
`GET /v1/member-agents/:memberAgentId/profiles` resolves it to the Profiles the
caller can see, with the same rule as All Agents (active Agent Profiles of the
current Organization). A teammate lands on the read-only page of the default
Profile, or the oldest visible one. A MemberAgent of another Organization
reads as not found, and a non-member is refused.

Every other Profile belongs to the MemberAgent of its Binding's harness. When
Core accepts a Binding write (Create, a Personal Remote Agent, the controller
switcher, or catalog sync), it asks Auth to assign the Profile to the owner's
existing MemberAgent for that harness in the Profile's Organization. A Profile
created on purpose therefore joins the existing Agent as one more Profile; it
never creates a second MemberAgent. Local assignment never creates a MemberAgent;
hosted assignment ensures the manually chosen hosted MemberAgent as above.
Neither moves an assigned Profile. It reads the harness from the Profile's
current Binding under a per-Profile lock that every Binding write also takes,
so a controller switch that commits first is never grouped under the old
harness. A failed assignment does not fail the Binding write: each catalog
sync, with or without a connected Computer, assigns any bound Profile still
unassigned whose harness has a MemberAgent, grouping by the same Binding as
the migration.

Detected-Agent setup retries the initial owner Direct Message independently of
the Binding. It repairs or reuses an existing chat, but never creates a replacement
after the owner deletes or converts the earlier chat. The existing Space index
history distinguishes those deliberate actions from setup that never created a
chat; no separate setup-completion flag is stored.

Nothing is configurable on the MemberAgent itself. Space participants remain
Agent Profiles: a MemberAgent is a grouping, never a Space member, message
author, or mention target.

The default Agent Profile is created with its MemberAgent. Its name is the
harness display name and is not editable, and it displays without a suffix:
`Felix Lu's Claude Code`. Every other Agent Profile is created on purpose with
a short owner-chosen name and displays as `Felix Lu's Claude Code · PR
Reviewer`. Handle rules are unchanged. A new model, folder, or task never needs
a new Profile. A Profile runs on one Computer and cannot change harness: Core
refuses a Binding write that would move an assigned Profile to another harness,
a `custom` controller included, with
`agent_profile_binding.member_agent_harness_locked`, and the web and CLI show
that the owner should create a Profile under the other harness's Agent.
Profile settings are the existing Binding settings plus folders (see Working
Folder List) and an owner-adjustable concurrency limit stored on the Binding
and read by the Service from the route catalog. Only the owner changes them;
Core checks that the root requester of the call is the owner (see
`developing/architecture/agent-transport-contract.md`, Request Chain).

A Session is one conversation of one Profile, and a Profile has unlimited
Sessions. A Session carries a title, its request chain, its Space, its folder
(fixed at its first message), its working copy, and its state. In a Direct
Message a Session is one Direct Message Space; New Chat creates another one for
the same pair (see `developing/product/space-collaboration.md`, Direct
Messages). In a group Space a Session is an Execution Context; "Continue in
another folder" is a fork with a new folder. Owners continue or fork their own
Sessions; colleagues continue only their own and always start fresh. Sessions
can be renamed, archived, and deleted; OpenMeld never archives a Session
automatically.

Mentioning an Agent in a group Space uses the Profile that is a member of that
Space. If none is, the default Profile is used: it joins for the owner's own
mention, and anyone else's mention creates a request to the owner (see
`developing/product/space-collaboration.md`, Agent Owner Participation). If
two of the Agent's Profiles are members, the mention must name one. No "last
used in this Space" state is stored.

When a harness disappears, its MemberAgent reads as missing after the debounce,
moves to an unavailable group, and keeps its Profiles, Sessions, and history.
After 30 days the owner gets a manual Archive action; nothing is deleted
automatically, and reinstalling restores the same MemberAgent. A second
Computer with the same harness adds no MemberAgent; the detail shows that
Computer and offers a Profile there. A forgotten Computer makes its Profiles
unreachable while the MemberAgent's state follows the remaining Computers.
When the owner leaves the Organization, the existing departure rules apply and
nothing is reassigned.

Welcome and repair cards for a MemberAgent are a presentation surface, as
Center Agent introductions are, not messages. There is one card per problem,
updated in place. The welcome card adds one line about the permission mode
(see `developing/product/organizations-and-center-agent.md`, Permission-mode
advisor).

## Product Role And Identity Boundary

An Agent Profile is the AI teammate identity users collaborate with in OpenMeld.

Personal Remote Agents use this same identity. Creation offers Local or Remote;
Remote asks only for a name and model and belongs to the signed-in member in the
current Organization. It requires no Computer, local working directory, native
session identifier, or local controller permission settings. The initial model
is stored on that Agent's Binding, independently of Center Agent settings.
Each Space, including a Direct Message, has a separate persistent conversation
for that Remote Agent. A personal Remote Agent is a `hosted` MemberAgent, so its
Direct Message Sessions use the same New Chat, rename, archive, and delete
operations as other agent Direct Messages.

Execution family and current availability are separate facts. Hosted Remote and
Center Agents do not depend on the viewer's Computer, local Service, local Agent
catalog, or connection/upgrade state. Their member reads must not wait for local
route preloads. Preload selection uses current Auth identity and validated
Binding evidence shared with that request's readiness read, never the member's
historical controller snapshot. Both Local-to-Hosted and Hosted-to-Local changes
must preserve that boundary without dropping needed Local reads. Real cloud
authorization, model, binding, and service failures
still block work; hosted does not mean unconditionally ready. A missing or failed
binding read is unknown execution evidence, not permission to assume a Local
Agent. Only confirmed Local identities receive Connect/Reconnect/Prepare local
recovery. Local missing-binding recovery remains available. Hosted and unknown
identities keep applicable model/settings guidance or a factual status hint,
never a local setup action.

Users should understand it as the named AI collaborator they can invite into a
Space, address in conversation, Wake for work, and recognize across replies.

An Agent Profile owns product identity and collaboration meaning:

- name
- instructions
- persona
- continuity
- visible teammate identity
- Space membership meaning

An Agent Profile name is a practical label for distinguishing configurations
of one MemberAgent. A default Profile's name is its harness display name, set
at creation and not editable. Ordinary interactive creation of another Profile
must not make a user create one profile per task: a new model, folder, or task
uses the existing Profile's settings or a new Session. An additional Profile
gets a short owner-chosen name such as `PR Reviewer`; it is shown after the
MemberAgent name, for example `Felix Lu's Claude Code · PR Reviewer`. The
former long template name (owner, controller, model, and reasoning, for example
`Felix Lu Codex GPT-5.6 Sol Xhigh`) is no longer proposed. If the chosen
visible name already exists for that owner, the creation surface adds the
first available numeric suffix such as `(1)` or `(2)`.

The name field appears after local agent selection in the single-page creation
form, before Advanced Agent Settings, which start expanded. Configuration changes never
rewrite the owner's text. When the Center Agent or another assistant creates an
Agent from an explicit work goal, it may infer a short practical role name such
as `Release Reviewer` or `API Debugger`. An explicit user-provided name always
wins.

It does not own local execution truth.

An Agent Profile is not a Runtime, computer, OpenMeld Service, controller binary, or
local process. Those objects may help the Agent Profile reply, but they are
local execution infrastructure, not the teammate identity users collaborate
with.

Local Agent Profile avatars intentionally use the bound Agent Controller's
brand mark, such as Codex, Claude Code, Grok Build, Cursor, or OpenCode, because the mark helps users
recognize how that profile runs. Assigning an unassigned Local Agent Profile
to a controller sets that mark; an assigned Profile's harness, and therefore
its mark, does not change. An unbound or unknown controller uses the generic agent fallback;
it must not invent Controller branding.
Local Agent message headers show the owner's name after a middle dot, without
an owner avatar or prefix. Profile popovers place availability beside the Agent
name and show `Owned by` with the owner's small Human Profile avatar and name.
Center Agent popovers show a cloud icon and the current model, with a settings
action that opens the current Organization's Center Agent section in App
Settings. They omit routine availability and default reasoning labels, but
retain unavailable or paused status and its explanation. This presentation is
shared by message authors, mentions, and member rows, including Thread replies.
Hosted Agents retain the `Hosted by OpenMeld` message attribution.
Hosted Remote Agent default avatars use the selected model provider's logo,
resolved from the exact provider namespace in the current `avatarModelId`.
OpenRouter is the calling channel, not the model provider; Remote Agents never
borrow Local Agent Controller product marks such as Codex or Claude Code.
Unknown providers or providers without a supported logo use the generic Agent
mark. A saved custom image or explicitly selected fluid avatar takes precedence
and stays in place across model changes. Avatar choice belongs to the Agent
Profile, not to its Binding. Every Web entrance resolves saved style, shape,
image, and current model identity from the Organization Profile Directory.
Missing `avatarStyle` means the automatic provider/controller mark, never an
invented saved Bot selection. Center Agent defaults remain the generic Agent mark.
Center Agents use circles; other Agents use rounded squares.

OpenMeld also has Human Profiles. A default Human Profile is created for the
signed-in user and is the right identity when a human or their current AI
assistant operates OpenMeld on the user's behalf. That is different from creating an
Agent Profile. The same default Human Profile follows the account across
Organizations. OpenMeld does not expose additional Human Profile creation while
Auth's additional-Human-creation capability is disabled; this does not hide or
invalidate existing non-default Human Profiles.

The platform may create managed Agent Profiles only for explicit system roles.
An Organization's Center Agent, including a Personal Workspace Center Agent,
belongs to the Organization itself. Its `ownerUserId` is null; its immutable
Organization and Profile identities own its lifecycle. The creating member is
audit attribution only. Current Organization roles authorize management and do
not confer access to the Agent's private Spaces, conversations, or member App
connections. Removing or deleting the creating member must not delete or
reassign the Center Agent. Ordinary human-owned Agent Profiles retain their
account ownership and owner-participation contract.

The current system role is the org-scoped `managedRole = "center_agent"` profile
for each org's Center Agent, including personal orgs. Legacy
`managedRole = "openmeld_assistant"` profiles are retained as historical data
but are hidden from the ordinary Agents home and are not created by current
setup. The Center Agent profile is managed from the Center Agent surface, not
from the ordinary Agents home. Setup does not choose or repair a managed
profile's Binding, model, Agent Controller, or Wake health. The default Agent
Profile of a MemberAgent is created with that MemberAgent from the harness
catalog report (see MemberAgent Layer). Every other ordinary Agent Profile
creation, and all profile execution management, still requires explicit user
or assistant intent.

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

The shared people-and-agents picker presents an in-flight creation immediately
as a selected row inside the target owner's existing group. This row is UI
feedback, not a committed Profile, Space membership, or execution readiness.
The picker keeps the user's selection intent when the committed Profile replaces
the pending row. A pending selected identity cannot be submitted as a member;
users can deselect it and continue choosing other members.

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

### Teammate request launch hold

Cross-user Agent creation requests (the future Request an Agent / Borrow
experience) are intentionally unreleased. This is a launch hold, not legacy or
deprecated code. Retain the request coordinator, approval UI, preferences,
schemas, and isolated lifecycle tests for later development.

`TEAMMATE_AGENT_REQUESTS_ENABLED` is the shared release decision. Production
does not expose a per-user setting or environment override. To develop the
future experience, change this decision only in an isolated branch and lane.
The service's explicit opt-in exists for isolated lifecycle tests only.

Core rejects cross-user create (including idempotent replay), approval, retry,
and approval-preference writes. Request reads expose only self-owned creation.
Old unclaimed Queue work is claimed and settled as a failed request without
creating an identity or running setup, so delivery and scheduled recovery stop
retrying it. Already claimed execution is not interrupted. Stored requests,
preferences, existing Agents, and Space membership are not deleted or migrated.
Inbox hides this source consistently in lists, counts, and email eligibility;
new approval notifications are not projected.

Self-owned Local and Remote Agent creation, progress, cancellation, and recovery
remain available. Web calls that progress surface **Agent creation history**, not a
teammate request product. Organization-owned Center Agent creation and lifecycle
are outside this hold. Agent actors representing a verified member remain able
to create for that same represented member.

Before reopening, finish the recipient-choice experience in isolation (provide
an existing Agent or create one, connect a Computer only when needed, and return
to the intended Space). Recheck Web creation and Activity entry points, Settings,
Inbox, CLI help and managed Skills, Center Agent tools, Core mutations and Queue
execution together. Approval of a frozen creation intent must not silently grant
broader sharing authority. Test both self creation and teammate requests before
changing the release decision; do not restore only a visible button.

Launch-hold contract audit: request payloads, status enums, error envelopes,
Service transport, setup, Wake, dispatch-owned actions, and diagnostics retain
their existing wire contracts. Old clients receive the existing Core forbidden
error for cross-user creation; new clients still create and recover their own
Agents against old Core. CLI discovery and bundled guidance narrow to the
released self-creation capability, without removing the recovery commands.
No runtime or command contract bump is needed. Deploy the Core enforcement
before Web and Remote Agent discovery changes; the CLI/Skill update is advisory,
not a forced restart or upgrade. Keep release versions and manifests unchanged
on the feature branch, use deferred release-ready validation, and stamp the
affected local components as available in the final publishing release.

An Agent Profile Creation Request is the one Organization-scoped coordination
flow for creating an Agent Profile owned by the requester or by another member.
Web, CLI, Local Agents, and the Center Agent use the same Core-owned request
state machine rather than implementing separate approval rules.

Each request freezes its creation intent.

The Center Agent working-creation tool explicitly selects Remote with
`connectionSelection: { kind: "remote" }`, or Local with a current
`{ candidateId }`. Remote selection maps to the existing
`hosted:remote-agent` configuration and personal Binding flow; `modelId` may
select a supported model or remain omitted for Core's default. The shared
configuration contract rejects Local-only settings on Remote requests instead
of dropping them. Resume/Fork retain their exact eligible Local Session
selection. Core rejects contradictory Remote/Local selections.

Web and Center working-creation requests require a run target before a new
request or identity is persisted. CLI/manual identity-only creation remains
valid with its limited semantics. `createdAgentProfileId` proves identity
creation; `completed` means the requested setup finished, not that the Agent can
reply now or that a Wake ran. Current reply readiness stays Core-owned and is
checked when needed. A failed setup retains its created identity and existing
retry path. No new watcher, mandatory Wake, or parent continuation is added.

Center-generated idempotency keys hash the existing normalized creation intent,
including the target Space, plus the originating request ID. Deep JSON key order
and normalized name/default notation do not define another intent. The same
intent owner governs both the hash and replay comparison. For an exact retry
across the key-format upgrade, Core also looks up the pre-canonical key within
the same Organization and requester. It reuses that key only for an existing
record with the same actor and complete normalized intent, including Space,
then delegates to the normal authorized replay path. A different Space still
uses its canonical key; the legacy format is lookup-only, not a new-write
format or an alias store. Existing durable requests retain their recorded IDs
and recovery paths; do not infer a failed creation from a missing response or
replace an already-created identity.

Web recovery keeps a failed creation's context. **Review setup** opens that
request rather than ordinary New Agent. Before identity creation, an owner can
choose a current Computer for the same local controller while retaining the
name, model, permissions, Project, session strategy, and intended Space. Resume
and fork recovery stays on the original Computer. The existing Core cancellation
and creation contracts end the old attempt before submitting the revised intent;
one requester-scoped recovery idempotency key per original request prevents
duplicate replacements across retries and tabs. A lost read fails closed. A
cancelled attempt can be explicitly restarted, including after interruption
between cancellation and replacement acceptance. Once a replacement is accepted,
recovery opens it rather than changing its frozen intent. A committed Profile
always uses the existing finish-setup path and must never be replaced this way.
The existing browser-local custom-folder intent follows an accepted replacement.
Private paths remain per-tab and may continue only on the same Computer; another
Computer retains the incomplete-setup marker and requires folder reselection.
Cancellation is presented as **Cancel setup**, followed by an explicit cancelled
outcome; it must not imply that the Agent was created or repaired.

Creation failure messages retain a safe reason and recovery guidance rather than
copying private RPC diagnostics into the request or Center Agent context. The
same public projection protects older saved failures, including truncated RPC
responses. Local Service diagnostics retain the original local error detail.

The frozen facts are:

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

Creation, approval, and retry return the durable request after acceptance; they
do not hold the response open until local setup finishes. Core delivers an
execution notification through the existing shared Core Queue and re-delivers
unclaimed approved rows from its minute scheduler. The Queue carries only the
Organization and request IDs. The request row owns intent, claim, identity
checkpoint, and terminal result; the Queue never authorizes creation. Duplicate
notifications cannot re-claim a started or terminal request. Execution rechecks
current Organization membership and the selected Computer before identity or
setup effects. This replaces execution inside the initiating RPC, rather than
adding another creation implementation or a client-owned continuation.

If a creation response is lost, clients query the exact requester/actor-scoped
idempotency key once and verify the original normalized intent. A missing or
unreadable result remains unknown, never a failed creation or permission to
mint another identity. Web waits on the exact request for up to one minute,
then hands the accepted state to Agent requests; the server continues without
the page. The CLI prints the accepted request and preserves the idempotency key
when its outcome cannot be read. Request views refresh only while creation is
active. JSON field order and omitted default fields are not changes of intent.

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
Before identity creation, an explicit model and reasoning selection must pass
the same canonical catalog validation as a Binding write. Current device
reports can add a compatibility rejection; absent device model evidence does
not invalidate a valid catalog selection. Local candidates expose model
options only when requested.

The owner can correct model and reasoning together while retrying the same
failed request. The correction requires the exact request version and changes
no identity, Computer, Project, or intended Space. If a primary Binding already
exists, its current settings win: a different model must first be saved through
Agent settings. Retry never restores stale model or permission settings.
Web offers **Review model** even when identity was committed before failure.

Creation initializes managed working-folder state only when the local writer
confirms that no configuration exists under its Profile lock. A later custom
choice, including a missing folder, is preserved. Binding initialization reuses
the same target without changing its settings; another target is a conflict.
Auth initializes Default Project only while its field-specific revision is
zero. New supporting Auth writes explicitly record zero; historical and old
writer inserts remain unknown (`null`). An explicit Project choice or clear
advances the revision, even when the value is unchanged. Name and avatar edits
do not advance it. Unknown history requires an explicit save in Agent settings;
a retry must not infer that an empty Project was never configured.
After Binding, Core completes the working-folder mutation and releases its
execution-target mutation lease before setting Default Project. The two
operations must not compete for the same lease. The request checkpoints each
completed post-Binding step so a retry of the same committed Profile skips that
step. If the working-folder outcome is unknown, Core does not advance to Default
Project; the lease and request failure remain visible for safe recovery.

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

Web creation requires choosing a local Agent Controller on a connected computer
before a new Agent Profile is requested. It does not expose manual unbound
creation or a choose-later option. Core rejects a new `source: web` creation
request without a Controller and target computer before writing any identity.
This Web entry contract does not remove intentional CLI manual profiles, existing
unbound profiles, recovery actions, or replay of an existing creation request.

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

`agentControllerConversationId` is the private local conversation ID that the
Binding keeps only for harnesses without Execution Context support and for the
retained `legacyAssociation`. For those harnesses it belongs to the Agent
Profile, not to one Space: if one such Profile is invited into multiple Spaces,
it continues the same private controller conversation. Every context-enabled
Session carries its own native conversation instead, so separate private
memory is a new Session, not a new Agent Profile. Two different Agent
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
(`Ask for approval`, `Approve for me`, and `Full access`) backed by sandbox
and approval settings. Existing Custom bindings keep their native configuration
and display as `Previous settings` until their owner selects a current mode;
Custom is no longer offered in permission pickers. The
labels and execution flags must stay controller-native, because Claude Code,
Codex, Grok Build, and future controllers use different permission names and
enforcement models. Grok Build uses its native `default`, `acceptEdits`, `plan`,
`auto`, `dontAsk`, and `bypassPermissions` modes. Plan remains a controller
execution mode, not proof of a filesystem boundary.
Owner-facing selection surfaces retain compact controller-native mode names
and explain the selected mode once in plain language. Relevant launch settings
remain inside technical details.
Outcome copy must not imply that Agent Controller Permission Mode changes Space
access, Agent availability, or separate Computer file-access limits.

Antigravity uses native per-invocation modes: Default preserves the CLI's
configured permissions, Accept edits passes `--mode accept-edits`, Plan passes
`--mode plan`, and Bypass permissions passes `--dangerously-skip-permissions`
with explicit owner confirmation. Headless requests cannot present approval
prompts; actions requiring approval are denied by the CLI. Plan is not a
filesystem sandbox. These settings apply to subsequent invocations, including
resumed conversations; Antigravity does not support live permission updates.

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

Codex app-server versions at or above `0.153.0-alpha.4` can switch the active
turn's reviewer between Ask for approval and Approve for me. OpenMeld uses
`turn/settings/update` and requires its `applied` acknowledgement. Full access
changes the sandbox and approval policy. A running `turn/start` call does not
replace that turn's sandbox, and OpenMeld does not interrupt and replay
commands to simulate a live sandbox change. Legacy Custom configurations stay
launch-only because their native policy is not known from the saved mode name.
Claude SDK sessions permit an explicit owner switch to bypass permissions after
launch, except in repair execution. Cursor ACP supports live Default, Ask, and
Plan transitions; Auto review stays launch-only on this transport.

Some no-prompt modes have no native live switch: Grok Build Bypass permissions
(Grok reads `--permission-mode` only at launch, and on grok 1.0.52 its ACP
`session/set_mode` is accepted and ignored), Cursor Run Everything (an ACP
launch flag), and Codex Full access (a turn sandbox). When the owner switches a
running task from an asking mode to one of these, the adapter applies the
owner's explicit, confirmed choice itself and acknowledges it as applied: it
answers each later permission request with the controller's own one-time allow
option and never selects a persistent rule. This is the owner's mode choice
carried out on the controller's own options, not an invented approval. For
Codex, the turn keeps its starting sandbox, so commands run with the access
Codex requests and full sandbox access starts with the next task. Switching
back to the launch mode stops this and restores the controller's own prompts.
A task launched in a no-prompt mode keeps that launch policy until the next
Wake.

The Center Agent may change an Agent Profile's permission mode for its owner
through the same canonical Binding write, using any mode the profile's
controller offers. It reads the per-controller options, including which ones
need explicit confirmation, from the shared permission-mode catalog, and it
chooses a confirmation-required mode only on the owner's explicit request.
A permission-mode change is non-additive: the Center Agent makes it only on the
owner's explicit instruction in the current turn, with the confirmation and
root-requester check defined in
`developing/product/organizations-and-center-agent.md` (Permission model).

Pending approvals remain explicit decisions. In the Space, an answered approval
leaves the pending-action surface as soon as the owner submits it, and the next
request that still needs the owner takes its place; a response that fails to
send returns the request with its error. On a Service that advertises
permission-mode update sequencing, the owner can choose a mode in the approval
card; Full access requires explicit confirmation. Web saves the canonical Binding
before sending the selected approval with the Binding id and saved mode. Service
waits briefly for the matching canonical route, attempts supported native updates,
and then delivers the selected approval. It never treats response metadata as
permission authority, never replaces a newer saved choice, and never claims
native application from a successful save. Save failure leaves the approval
pending. Native rejection or delayed catalog delivery retains the current mode
and still delivers the owner's explicit approval. Older Service requests keep
the ordinary approval controls without this additional mode selector.

Changing the Agent Controller (offered only to assign an unassigned Profile),
unbinding it, and changing the local working folder are different because they change the execution target underneath future work
and can interrupt an accepted Wake. Every maintenance surface must read the
owner-sharded RuntimeCoordinator execution state, independent of the current
Space. That read is advisory: before committing one of these changes, the writer
must acquire a short-lived owner-shard execution-target mutation admission and
hold it across the PostgreSQL or local Service mutation. RuntimeCoordinator serializes
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
Agent Profile recovery in Web does not expose migration or a bulk reconnect
action. A first-connection action is offered only for a confirmed missing
Binding and uses the non-replacing ensure write; an existing execution target
must not be moved by that recovery path. Ordinary Computer reconnect must retain
the existing identity and connections, not ask the user to reconnect each
Profile. Explicit cross-computer migration is deferred until its target,
continuity limitations, and confirmation have a dedicated product contract.
Existing low-level, authorized repair operations remain separate from this Web
recovery surface. A Computer or service reconnect must never move Bindings
implicitly or guess identity from a computer name. A runtime reconnect preserves
the Binding settings that are current when Core
accepts the write. Reconnect clients must omit controller settings instead of
replaying a previously read Binding snapshot; only an explicit settings edit
may carry those fields and its expected `configurationRevision`. The PostgreSQL writer
uses that revision as a compare-and-set fence and re-reads before a bounded
retry when a settings write wins the race. Reconnecting must never overwrite a
newer permission, model, reasoning, collaboration, conversation, or OpenCode
permission choice.

An explicit settings edit is successful only when the fresh Binding projection
contains the requested value. A changed value must be fenced by both the
Binding id and `configurationRevision` that the writer read, and the PostgreSQL update
must change that row. If a Service reconnect or another settings edit replaces
that write target, Core returns a settings conflict instead of accepting the
new Binding's unchanged value. Web clients also compare an accepted response
with the requested permission, collaboration, model/reasoning, or OpenCode
permission before showing “Settings saved.”

For personal Agent Profiles, the authoritative `ownerUserId` is also the Binding
owner and RuntimeCoordinator shard owner. Organization Center Agents instead
have an `organization`-owned hosted Binding and use native delivery authority.
They never borrow a member's RuntimeCoordinator shard. An administrator acting
within the Profile's canonical Organization remains the action and audit actor
and must not become a second Binding owner. A personal Agent Profile write that
discovers an older enabled Binding under another owner must acquire mutation admission from
every affected owner shard before changing the Binding. Disabling admitted
legacy Bindings and installing the Profile owner's target are one atomic PostgreSQL
write; any failed step leaves the previous enabled Bindings intact. Unavailable
admission or an incomplete reconciliation fails closed. The PostgreSQL write boundary
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

When a running Codex, Claude Code, Grok Build, Cursor, OpenCode, or Antigravity
turn asks for permission,
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
response. When a controller offers a "don't ask again" choice but does not
honor it itself, as Grok Build's ACP does not (Claude Code, Codex, Cursor, and
OpenCode honor theirs natively), OpenMeld keeps the owner's
choice for that controller conversation while the OpenMeld Service keeps
running, and answers later matching requests with the same kind of option the
controller offers: an allow-always choice covers later requests of the same
tool kind, and a deny-always choice covers the same exact command. A request
without an exact command is never denied from memory. These choices are not
yet persisted, so a Service restart forgets them and the controller asks
again. A one-time choice never becomes such a rule. Cursor Run Everything keeps its native one-time automatic allow
behavior rather than pausing for an approval that the selected mode already
resolved.

A dispatch-scoped first-party OpenMeld Space Action is not a general controller
command approval. OpenMeld may make its own `reply`, `status`, and `stay_silent`
tools approval-free because they can write only one validated proposal for the
current dispatch and still require RuntimeCoordinator publication. OpenMeld
may require Antigravity's final response to match a dispatch-scoped structured
output schema because its CLI has no proven per-invocation structured-tool
configuration surface. After validating that `reply`, `status`, or `silent`
outcome, the trusted adapter invokes the same dispatch-owned writer without a
shell. The model never receives a new command permission, and ordinary shell,
filesystem, network, and MCP actions remain under the controller's native
policy. `Ask for approval` therefore remains authoritative for ordinary
controller actions without blocking the Agent's chosen Space outcome.

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

Handoff `execution.access` is an additional task restriction, not a replacement
for the receiving Profile's permission mode. `read_only` is a Context access
value, not a Codex Profile permission mode. The supported Codex modes already
allow writes inside their working folder; unknown previous/custom settings are
not silently widened and fail boundary verification. An actual native read-only
response cannot satisfy a requested writable Context. A handoff never supplies
or changes the receiver's controller permission mode.

Starting a new Codex task for its owner does not add a single-folder restriction.
The same rule applies to a currently verified Center delegation from that owner.
With no explicit task access choice, the new task uses the current Profile
permission mode and Computer policy. The Task menu's **New task** starts a
separate conversation without choosing a narrower file scope. Explicit project,
read-only, and Space-only tasks keep their selected restrictions. Continuing or
forking an older restricted task does not reinterpret that restriction as a
default; the owner can start a new task to use their current settings.

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

A local Agent Profile has a device-scoped working-folder configuration: a list
of folders with one default (see Working Folder List). Each folder entry has
exactly two wire modes. The existing schema field is `workspaceMode`; this
compatibility name refers to a profile's local working folder and must not be
confused with **Workspace**, the Web presentation term for the selected
Organization context.

- `openmeld_managed`: OpenMeld resolves and maintains the profile's managed
  working directory on that computer. No custom path is stored in the mode.
- `custom`: the current computer stores and validates one explicit absolute
  working directory for that folder entry.

Importing the current native Codex or Claude Code conversation records its
observed folder through the same local working-folder writer, only when no
configuration exists. The local envelope may record `imported_native_session`
with that conversation's controller and ID. An explicit custom-folder save
replaces that origin with `explicit`; selecting managed removes it. Origin is
valid only for the envelope's current `updatedAt`. Legacy configuration or
metadata retained by an older writer has unknown origin, not inferred human
intent. The owner-private saved-configuration read exposes only the origin kind.

An imported folder is an observation, not authority to follow a moving native
worktree. If it disappears, OpenMeld keeps the saved folder and fails closed.
The owner can restore the original worktree in its app or explicitly select a
folder for new work. A different folder does not restore the original files.
Import retries must not replace an existing configuration, including a later
explicit choice. No client guesses a replacement path, creates the missing
custom directory, clears native history, or automatically changes the Computer.

Working-folder mode and its resolved path are local execution facts. They are
scoped to the current device and OpenMeld lane, may appear in owner-self
diagnostics, and must not become public Agent Profile identity,
Organization-shared data, Agent Activity, snapshot data, or Center Agent
context. The path-free folder projection in Working Folder List is the only
cloud form of a folder. A missing or invalid custom folder fails closed; it
does not silently become `openmeld_managed`.
Center runtime-settings results expose the local mutation's Profile, status,
and exact target Computer/lane, plus existing safe Binding/readiness evidence.
The configuration version remains null when the Service write receipt does not
report one; a Binding revision is not a working-folder configuration version.
They omit local mode and
absolute paths, including failure details. Selecting custom or managed through
that operation saves the local folder first, then clears Default Project
through Auth's existing writer. A failure to clear reports partial setup and
must not claim that future tasks use the saved folder.

The working folder may be read or changed only while the Profile's canonical
Organization is the active Workspace. Switching Workspaces never makes another
Workspace's Agent Profile or its local execution configuration manageable.

When the exact current Service advertises Local Folder Picker, a custom working
folder uses **Choose folder on this computer** as the primary input action. The
native chooser returns one folder per add action; the Profile keeps the result
as one entry of its folder list. Selection fills the local settings draft; **Create agent** or **Save
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

Create and edit surfaces share one Working folder source control:
`On this computer`, `From a project`, or `Let OpenMeld choose`.
Project creation and details are contextual actions within the Project source.
The existing available default connection is selected without another radio or
candidate scan. Empty source-specific selections block submission; managed
mode cannot inherit a Project path. Choosing a Project writes only its cloud
ID, not a second custom-folder preference. Changing its device default is a
separate, explicitly confirmed Project mutation affecting future work for all
Agents using that Project on that computer.

When the Working folder selector opens, it acquires the saved Default Project
through the existing account-scoped Auth Profile query and the saved local
working-folder configuration from the exact owner Service before enabling
Save. The owner card and editor share an in-memory query scoped to account,
Organization, Profile, Computer/lane and Binding; private paths are never
included in browser-persisted or shared Profile snapshots. Cached values can
display immediately and initialize an editable draft. Fresh reads update an
untouched draft only; they must not overwrite user input. The Service read distinguishes configured, missing, and invalid
configuration. It does not migrate configuration, create a managed folder,
validate its current availability, or substitute an effective Project or
controller-session directory. Its configuration version identifies the stored
envelope version (v1, v2, or v3), not a revision or compare-and-swap
precondition. An older Service
without the read capability returns an explicit update-required result.
A pending Auth read started before opening cannot initialize the draft:
cancel that read, keep the existing display snapshot stale, then acquire the
authorized snapshot for this opening. A failed read keeps Save disabled and
provides retry with its diagnostic context, preserving the draft.
Once acquired, the selector retains its draft, pending save, and error while
Profile, readiness, or mutation eligibility queries refresh. It keeps the
original Profile and Binding target; changed or unavailable target evidence
blocks Save without silently moving the draft to another Computer. The owner
closes and reopens the
selector to review a changed target.

Center Agent and Space recovery working-folder writes verify their Binding target inside
the existing execution-target mutation admission before calling Service. The
subsequent Default Project clear verifies that same target inside its existing
future-work settings admission. These are two ordered writes, not one atomic
transaction. If the target changes between them, the local save receipt remains
visible, the Project is not cleared, and setup reports partial failure.
Retrying an unchanged draft finishes the remaining Project write without
repeating an acknowledged local save. Recovery distinguishes saved settings
from Core-confirmed availability; it never restarts a failed task implicitly.
Managed folder preparation and access checks precede configuration replacement
under the existing local writer lock. Inspection checks existing managed folders
and, for lazy creation, the existing parent; dispatch prepares and checks the
directory without rewriting the saved preference.

Profile settings and Space recovery send their frozen `expectedBindingTarget`
on the private read and both HTTP writes. Core verifies the same canonical
Binding before and after the asynchronous read, and rejects a mismatched
current Binding even after Save has started;
disabling a later click in Web is not the write fence. A successful local save
followed by a failed Default Project update keeps the dialog open with an accurate
partial result in both Profile settings and Space recovery. Ordinary explicit
Computer configuration may omit this precondition and retains its existing
target semantics.

`defaultProjectId` is a separate Organization-scoped cloud preference for a
local Agent Profile. It identifies the Project that future Wakes and new
sessions should use by default. It does not store a folder, permanently assign
the profile to a Project, or move the profile's current controller session.
Remote Agent and Center Agent Profiles do not show or use this field in the
MVP.

An existing OpenCode session remains bound to its native working folder. If
that folder does not resolve to the Agent's current effective working folder,
Wake must resolve the conflict before prompting or forking the session. Working Folder Recovery
lets the owner explicitly choose the verified original folder or a new
conversation for the same Agent Profile. OpenMeld does not run in the former
folder or replace the session automatically.

### Working Folder List

Implementation status: shipped. The MemberAgent program (PR #236) is merged,
and `MEMBER_AGENTS_ENABLED` is on.

The local profile envelope (v3) stores `folders: [{ id, kind, path | projectId,
displayName }]` and `defaultFolderId`. The local OpenMeld Service mints every
folder id and remains the only writer of the envelope. A v1 or v2 envelope reads
as a one-element list whose entry is the default, and a v3 envelope keeps the v2
`workspace` field mirroring the default folder so an older Service still
resolves it.

When the Service reports a folder save, Core writes a path-free cloud projection
`(profileId, folderId, kind, displayName)`. No path ever reaches the cloud. A
cloud folder id that the local envelope does not know takes the existing
fail-closed path; it is never replaced by a substituted path. Execution Context
preferences carry an optional `folderId`. Core strips it when the root
requester is not the owner, so colleagues' work always uses the default folder.
Agents, including the Center Agent, choose folders by id and display name only.

Owner folder changes refuse an envelope the Service can't read. The one
exception is the owner-only `repair` operation, which names an OpenMeld or
custom folder (never a Project folder) and makes it the default, adding it when
missing. On an unreadable envelope it replaces the list with just that folder
and restarts the folder-save counter; Core replaces its recorded list with a
repair receipt whatever revision it held. Repairing with the current default,
or choosing it again with `set_default`, prepares it again: a missing OpenMeld
folder is recreated and a custom folder is re-checked. Both default changes run
under the execution-target admission. Repair needs the Service's
`repairProfileFolders` capability, so recovery's "Set up again" uses it and an
older Service refuses instead of reporting a folder it did not prepare. Like
every capability, the Service advertises it only after Core that accepts it is
deployed (Core before CLI). After a local default change Web clears Default
Project even when it saw none, since another tab may have set one. Web's Working folder dialog is the one
surface for these changes, including working-folder recovery from a failed
task.

A Session's folder resolves in this order and is then fixed at its first
message: explicit choice, the folder of the Session it continues or forks, the
Profile's default folder, then the OpenMeld-managed folder. The managed folder
is used only when no earlier source names a folder; a named folder that is
missing or invalid still fails closed and is never replaced. Direct edit and
isolated copy keep their existing meaning; two Sessions in one folder follow
the folder-scoped conflict rule in Agent Profile Work Coordinator.

### Working Folder Recovery

A working-folder conflict gives the owner an actionable choice in the Wake
before the Agent starts. The Profile's identity and Space memberships survive recovery.
The owner can continue the previous conversation in its verified original
folder, start a new conversation in the currently selected folder, or leave the
task without running it. Starting a new conversation preserves the old
native history and explicitly warns that it will not carry into the new one.
Neither choice changes the execution Computer.

Normal Wakes require no extra confirmation. Only a verified conflict opens a
recovery decision. A targeted read of the existing native session store avoids
starting a second controller just to inspect its folder. The local Service verifies the native conversation and its
folder, current Computer file access, and the expected execution target before
applying a choice. Paths stay within the existing owner-only local-control
boundary. A missing folder or unavailable Computer stays actionable and does
not trigger an inferred substitute or credential change.

Web and the Desktop renderer reuse the existing question card. Human CLI and
Agent View consume the same typed interaction through `openmeld space respond`,
with an explicit response and exact request identity in non-interactive use.
A client must not implement recovery by independently clearing a conversation
and updating workspace settings.

RuntimeCoordinator owns the existing durable pending interaction and its
resolution. Inbox projects that question as Needs action for the Profile owner, using the existing delivery
preferences. Reading or dismissing the Inbox item does not resolve the decision.
The requester can see that the owner needs to act without gaining local paths or
management permissions. Repeated reports do not create repeated reminders.

Answering continues the same accepted task; it does not repost its prompt or
create a second Wake. Continuing the previous folder applies to that task only
and does not silently change Default Project. A successful new conversation
uses the existing result-owned Binding update for subsequent Wakes. The old
native history remains saved. The existing eight-hour interaction expiry,
response-delivery watchdog, owner authorization, and exact-response idempotency
apply. Stop, expiry, Service loss, and final reply follow normal visible outcome
publication. Previously terminal Wakes remain terminal; a new Wake receives the
new preflight choice without rewriting their history.

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
replace the remembered values. Restoring a valid permission mode from the
same user's Core-owned successful-creation defaults also restores consent for
that mode; creating another Agent must not ask for the same consent again.
A newly selected dangerous permission mode still needs explicit confirmation.
An unfinished browser draft alone never establishes consent.

With a local Agent selected, the default creation journey allows Create Agent
without opening customization. Required account or working-folder reads have
visible loading explanations. Invalid explicit selections remain blocked with
a concrete reason and a direct action to open the relevant configuration
editor. Permission review opens customization and the Permissions editor,
focusing the confirmation control. Working-folder blockers offer a one-click
OpenMeld-managed folder action that clears the Project selection and prevents
late defaults from overwriting that explicit choice.

Web creation always presents the complete built-in Local Agent catalog in the
canonical order: Codex, Claude Code, Grok Build, OpenCode, Antigravity, then
Cursor. Catalog visibility is product discovery, not evidence that an Agent is
installed, enabled, signed in, or ready. Selecting an unavailable entry keeps it
selected for inspection while the Binding target remains unset. A full-width
dashed recovery panel then names the exact blocker and offers the nearest direct
action: the Agent-specific install guide, an inline enable switch, sign-in or
setup guidance, or a retry for unknown Computer evidence. Creation becomes
available only after the existing canonical eligibility projection provides a
valid local Binding target.

The selected Local Agent's Usage summary appears at the far right of the Agent
name row above Advanced Agent Settings. It consumes the already loaded local
runtime projection and its query cache; opening creation must not start a second
provider Usage request. A small skeleton may replace only that summary while
the projection is loading. Missing or unsupported Usage leaves the rest of the
form interactive and does not create another readiness rule.

For a new Web session, a remembered Project id alone is not enough to restore a
working folder: it does not confirm a connection on the selected computer.
The form starts with Let OpenMeld choose instead. An explicit Project or custom
folder choice remains explicit and must be completed before submission; Resume
and Fork retain their selected Session's Project. Switching back to Let OpenMeld
choose clears the Project and folder selection together.

The creation page keeps `Create Agent` as its task heading and explains that a
local agent runs the Agent Profile. A saved execution target is configuration,
not evidence of a current Service connection. Empty-state setup guidance must
use the current matching Service projection; failed, missing, or mismatched
checks offer a retry instead of claiming that local agents are not installed.
Computer setup entered from creation preserves the Organization-scoped
`agent_creation` return intent through fresh-session consumption. Back and
verified completion return to Agent creation, not the Computer directory.

Web may also keep an unfinished creation journey as a browser-local draft so a
member can leave the flow and return without rebuilding ordinary selections.
This draft is scoped by Organization and user, is advisory rather than
authoritative, and may contain only the selected Agent Controller, supported
model and reasoning choice, supported controller settings, and a cloud Project
id. It never stores a custom absolute folder path or a dangerous-permission
confirmation. Web restores the draft only after validating every value against
the current local-agent catalog, model catalog, permission options, and Project
list; otherwise it discards the stale draft and uses current defaults. A restored
new-session draft uses Let OpenMeld choose because the stored Project id cannot
confirm a current local connection. A
successful creation retains these latest selections for the next creation, just
as leaving without creating does. Restore the validated draft once into the
editable form state; edits must not remove the selected Agent or collapse its
settings. Restoring or abandoning this
browser draft never writes or replaces the Core-owned remembered creation
defaults. Once the member changes the selected local Agent or execution target,
that direct choice ends draft restoration for the current open creation flow;
later renders must not restore an older choice over the member's input.

The creation history uses the shared Fluid table used by Invitation records.
It shows the Agent, creation result, and recovery actions without implying that
self-owned creation needs approval. Transport envelopes remain diagnostic
evidence, not the primary error text. With a usable computer, creation offers no
connect-another-computer action; a computer selector appears only when multiple
eligible computers are available. Missing connections retain inline setup.

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

- which accepted Wakes hold the Profile's bounded work reservations
- the ordered Wakes waiting for a context or reservation
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

One Agent Profile may have as many independent Execution Contexts reserved as
its concurrency limit allows, and at most 50 waiting Wakes. The limit is stored
on the Binding, defaults to five, and is owner-adjustable and visible; the
per-Computer limit is likewise owner-adjustable. Owner and colleagues share the
Profile's limit in FIFO order. Follow-ups in one context remain serial. New task,
completed-history fork, and independent discussion scopes can run together when
the local Service verifies their resource isolation. Legacy work without a
context drains exclusively. Waiting order is the owner-shard transaction
acceptance order; a blocked context does not prevent eligible independent work
from using a free reservation. There is no priority system in this version.
A published source message stays visible in its conversation; its admitted Wake
may show that it is queued. Pending plain-text follow-ups in the Composer Queue
have not been published or admitted as Wakes yet. They remain editable pending
Space input until ordinary publication or an explicit Steer consumes them.
Different Agent Profiles remain independently admissible and may work in parallel.

Composer follow-ups attach only to one confirmed active response started by the
current author in the same discussion. Another member's request is published as
independent work; it must not enter that author's pending-input queue or steer
their turn. Send now applies an input to the exact running turn. It is disabled
while that response is starting, queued, waiting for another app, or waiting for
an interaction. It does not publish another Wake or grant scheduling priority.
Provider occupancy is labeled `Waiting for another app`; Coordinator admission
waiting keeps `Waiting for earlier tasks`, as does a reserved Wake that the local
Service still holds behind other local work, until the Service starts it. A
conversation fork does not grant another requester access to its history or
bypass the folder-scoped conflict rule below.

Resource conflicts between local tasks are folder-scoped: each task carries a
resource claim naming its folder roots (the resolved folder and, for a Git
checkout, its common Git directory), and tasks whose roots do not overlap never
conflict. Two direct-edit Sessions in the same folder run concurrently; the
later one receives a `shared_folder` notice with a one-click switch to an
isolated copy, and each task prompt lists the other Sessions editing that
folder. A task that waits on another task's folder shows `Waiting for another
task in its folder`. Tasks whose root requester is not the owner default to an
isolated copy when the folder is a Git repository; the Service makes that
choice inside `mode: "auto"`. The resource-claim contract is in
`developing/architecture/agent-transport-contract.md`.

For migrated Profiles this replaces the former one-slot FIFO and Profile-wide
native conversation model. The primary Binding still owns the connection and
launch settings. Migration freezes a finite legacy boundary, preserves accepted
legacy/recovery work, and retains the old native conversation as an unclassified
legacy association. Current Binding identity is reread under the existing owner
mutation boundary before Context mode activates. Work accepted for an earlier
Binding does not block activation; it is not attached to the legacy association
and its promotion recheck settles it with a visible no-execution outcome. A
failed activation attempt is recorded for that Profile alone with its own
backoff; it never holds other Profiles' migrations or fails the Wake acceptance
that triggered it. Switching to serial admission
preserves existing Contexts, running reservations, waiting Wakes, and their
source/result associations; it does not downgrade the persisted format or merge
native histories.

The Web Task menu offers new work and source-specific continuation or fork for
supported local Agents. CLI sends use `--new-task`, `--continue-from <signal-id>`,
or `--fork-from <signal-id>` with one explicit `--wake` target. Source selection
never copies permissions, active work, or publication authority. A plain mention
continues the discussion's most recently accepted Context. It requires an
explicit source choice only while another Context of the same requester and
discussion still holds reserved, waiting, or recovery-held work on the same
Binding, Service runtime, and Controller. When that latest Context belongs to
another Binding, Service runtime, or Controller, the plain mention starts a
fresh Context instead of failing; the earlier Context stays available through
explicit continuation and work history. A discussion accepted before Core kept
its latest-Context index is ordered by the acceptance records of the Wakes last
accepted into each Context, never by when a Context was created. When those
records are missing, tied, or too many to read, the requester chooses a source.

Official Antigravity ACP supports new and continued Execution Contexts using
Agent settings, including managed working copies. It does not support history
forks or extra `space_context`, `read_only`, or bounded `workspace` restrictions.
The Web Session menu exposes only supported operations and Access offers only
Use agent settings. A new session separates conversation history, not filesystem
permissions. Current-folder writers follow the folder-scoped conflict rule. The legacy
`agy` installation fails independent work with official ACP setup guidance.
A lost native session fails continuation; it must not silently start fresh.

Connected harnesses without Execution Context support retain their ordinary
thread Wake behavior: work for one Profile remains serial through its existing
Binding. This holds after a Profile switches to such a harness from one that
activated Contexts: its Wakes are admitted as serial Binding work, and only a
Context-capable harness's frozen legacy association stays fenced from Binding
conversation writes. Explicit task/context selections fail visibly until the
harness supports them; a thread alone does not opt an unsupported harness into
the new protocol.
This compatibility rule does not enable suspended controllers or bypass current
connection, permissions, or readiness requirements.

New Codex and Claude tasks keep the Agent's native tools and permission mode,
whether requested by the owner, a teammate, or another Agent. Projects select
the starting folder; they do not restrict the Agent to that folder. In parallel
mode, an ordinary Claude Wake starts an independent native context when no
retained context has been selected. It needs neither Git nor a container engine.
A Wake continuing a retained context keeps its existing access. Forks preserve
the source restriction unless an explicit supported choice changes it.
Agent mention menus separate Session, Working copy, and Access. Selecting a
separate copy or a Project does not itself select a file restriction: new Codex
and Claude tasks keep Agent settings unless the requester explicitly chooses
additional access limits. Forks preserve their source's working-copy mode as
well as its access contract. Explicit access choices can select Space-only,
read-only, or bounded project access. Read-only and bounded current-folder
access require Codex; bounded Claude project access requires a separate copy.
The CLI options
are `--task-access space_context|read_only|workspace` and
`--task-workspace isolated|current`; omitting `--task-access` keeps Agent settings
even with `--project` or `--task-workspace isolated`. Current-folder writers
follow the folder-scoped conflict rule. An independent project task requires a confirmed working folder that
is the root of a Git repository with a committed HEAD. The Service checks the
source against the Computer owner's file policy, then prepares a private Git
repository and worktree from the exact commit observed at first local preparation.
It copies committed content only; dirty files, ignored configuration, credentials,
and dependency directories are not copied. Each task owns its Git metadata.
Retries and continuation preserve the task's worktree and frozen starting commit.
The local Agent receives the repository label, task working folder, and starting
commit; it does not discover a source by searching the computer.

An explicit task boundary confines project files and Git metadata. Codex retains its
native runtime's platform temporary-directory rules; that is not a promise of
complete temporary-directory isolation. Explicitly bounded isolated Claude project tasks require a
running Docker or Podman Linux-container engine on macOS, Linux, or Windows.
The Service mounts only the task-owned repository and worktree, disables
container networking, runs as a non-root user, and gives Claude restricted file
tools plus a dispatch-scoped project shell. Before model execution, it proves
allowed reads and writes inside the task and denied reads outside. If the engine,
mount, or containment check fails, the project task fails visibly before Claude
can read project files. Selecting an independent worktree does not grant access
to an otherwise forbidden source.

The first accepted Wake request remains frozen while it waits, moves to the
front, or is redriven after transport recovery. Prompt, attachments, source
message, reply destination, target Profile, Binding/configuration revision, and
execution identity belong to that Wake. A refreshed queue timestamp, recovery
reason, or later display-name snapshot does not create a different request. A
real immutable-content mismatch fails that exact pre-execution Wake visibly, or
stays retryable if RuntimeCoordinator cannot safely settle it; it is never
treated as a duplicate, a Computer-offline verdict, or permission to execute
the changed content. Its failure tells the user to send the request again and
open Diagnostics if needed; it does not expose a Check status/Recovery action
or change current Wakeability.

`Queued` means that a Profile reservation or the selected context's writer is
unavailable. It is not the
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
observational or not evaluated, does not use Usage as an admission condition. Once a
Local Agent's versioned capability matrix declares native Usage support,
missing, stale, expired, or currently unavailable Usage remains an observation,
not an execution prerequisite. Otherwise ready Agents may attempt a new Wake;
the provider remains responsible for enforcing its actual capacity. This avoids
making a healthy account unusable when its quota endpoint is slow. Existing
authentication, permission, current Controller report, and execution identity
requirements remain mandatory. During a mixed-version rollout, legacy Usage
reports remain parseable without adding a guessed admission block. A
fresh exhausted Usage Limit projects `Unavailable` and blocks the Wake before
admission. These decisions use the current report already held by Core and must
not add a provider call to the Wake hot path. Core and the Local Service consume
the same matrix from `@openmeld/agent-runtime`; a Local Agent upgrade changes
this behavior only through one reviewed matrix update backed by official
provider evidence and a real smoke test.

A structured Wake failure may update future Usage admission only when the
accepted execution's exact Agent Controller has native Usage support in that
same matrix. An observational, unsupported, or not-evaluated controller may still
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
This automatic continuation is an internal Coordinator command authorized by
the frozen interrupted Wake identity and owner-shard Binding/configuration
fence. It does not inspect or execute the public Execution Recovery
`retry_as_new_execution` action, which remains unavailable.
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
Profile authorizes recovery but is not shown as the original sender. Space File
references keep their exact immutable revisions and Agent References keep their
structured targets through the ordinary Space message writer. If that writer
proves a preserved file revision, Wake, Reference, or Human Mention is no longer
valid, the interrupted work moves to `Needs attention` once and keeps later work
held for owner review. Temporary writer or storage failures retry the same
continuation identity instead of producing a partial continuation.

Owners may keep editing settings while work is queued or running under the
existing capability rules. A running Wake keeps its accepted Binding and
configuration revision. Saved model, reasoning, controller, and launch-only
permission changes apply to future work. A native live permission update is
shown as applied only after the provider acknowledges it.

An approved Usage continuation rechecks its exact Binding, controller,
configuration revision, and nullable Default Project before it can continue,
not only when Usage first recovers. Continuation authorization, head admission,
and every cloud-owned future-work settings change share one owner-shard ordering
boundary. If the continuation becomes running first, the current Wake keeps its
accepted settings and the saved change applies to later work. If the setting
change wins while the continuation is pending or authorized, the continuation
moves to `Needs attention` without executing. During a rolling deployment, an
older owner shard that cannot coordinate future-work settings rejects that
settings save before changing the preference; ordinary Wakes keep using the
unchanged fast path.

## Agent Profile Operational Context

The Space composer also consumes this existing owner projection for paused work
in the current Space. It places the existing continuation/skip confirmation beside
pending inputs in the same tray. Sorting, Send now, editing, and deletion retain
their existing controls. The original requester can also skip their own paused
work when the recovery gate contains only that requester's execution context.
They can fork a read-only or Space-only context without inherited permission
overrides. Mixed-context gates, legacy work without a verifiable requester,
and shared write permissions retain owner-only recovery. The owner shard
rechecks this scope when authorizing the operation. A task in another Space
is not presented as this conversation's interrupted work.

Text follow-ups to the sender's one active response enter the composer Queue,
including while the first send is being confirmed. Queue intake can resolve
the original client-message identity into the exact dispatch; it never invents
a second execution. Send now requires a running execution and an acknowledged
steering receipt. When multiple responses belong to the sender, Reply to the
original request selects the target. Another person's request remains independent.
In a shared Space, an explicit Agent mention or Reply to the original request
selects the follow-up target; ordinary messages to people do not enter its Queue.
Queue ordering and uncertain-delivery holds apply to the same task chain, not
every task assigned to that Agent. A failed task cannot block another member's
independent Queue.

After the existing occupied-conversation waiting period, fresh available Usage
reports may trigger one automatic native fork for Codex work that never began a
turn. This is limited to automatically selected, explicitly read-only or
Space-only contexts. Writable tasks, inherited unrestricted permissions,
explicit source selections, and already forked contexts keep manual recovery.
The continuation still waits for the original local attempt's withdrawal and
uses the verified completed-history cutoff. Missing evidence never grants a retry.

On fork continuation, untouched pending inputs from the original source author
follow the replacement in their existing order. They keep their input identities.
Claimed, delivered, rejected, or uncertain inputs retain their original delivery
records; they are not replayed. Send now resolves a fresh execution binding before
the first delivery to a successor. A continuation is not a file rollback or a
promise that another app has stopped modifying shared files.
After the branch succeeds, its follow-ups continue without a second confirmation
when no unrelated work is held. Other held work still needs owner approval.

Legacy Binding-only conversations without a retained per-Wake context offer Skip,
not a fork that cannot verify its source. A previously authorized legacy fork
that never acquired a context can also be skipped. A new task establishes the
context required for later branch recovery. Continuations validate the original
recipient against the retained dispatch and exact source-message identity.
Implicitly addressed messages do not require an explicit Wake chip; the original
recipient is not recomputed from current Space membership.

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
such as `1 active · 3 queued`, in existing Profile Details. The read-only workload
combines existing Space Wake progress and pending Space inputs across the Agent's
Organization conversations; it does not create another execution queue. A queued
input and the Wake that consumes it are successive states, not two tasks.

Conversation access controls each row's message preview, Space name and link for
owners and other members alike. Inaccessible conversations contribute only neutral
counts. Owning the Agent alone does not reveal private conversations beyond
the derived owner-observer access defined in
`developing/product/space-collaboration.md`, Agent Owner Participation. An unavailable
or incomplete source makes the workload unavailable rather than claiming an exact
zero or partial total. This default Organization visibility does not grant Queue,
Steer, recovery, stop, or settings mutation authority. Controller conversations,
local paths, Computer details and owner diagnostics keep their existing boundaries.
Privacy settings are separate future scope, not per-surface switches added here.

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
status and may additionally name one exact, structured reason from a closed
enum visible to Organization members:

- `not_signed_in`
- `no_subscription`
- `org_disabled`
- `version_too_old`, with the unsupported model
- `computer_offline`
- `usage_exhausted` (**Usage Limit reached**), with the reset time when current
  authoritative evidence provides one

These reasons help teammates avoid assigning work that cannot start. They are
a narrow allowlist, not provider-account access: the projection still omits
quota numbers, subscription tier, provider and account identity, Computer
names and other Computer details, Space details, local paths, command text,
route and Binding evidence, controller and conversation identity, task content,
raw errors and diagnostics, grants, audit records, and every owner recovery
action. Any blocking reason outside the enum remains the generic public
Wakeability state.

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

A retained Wake failure, provider-access failure row, or persisted
`readinessImpact` remains outcome and diagnostic history for that exact Wake.
It does not block a later Wake or choose a later recovery action. A lasting
problem changes current Wakeability only after its owning current fact is read
again—for example, a current Usage report, current Service compatibility fact,
or current path-free working-folder observation.

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
It must also show a newer Core `Checking` verdict immediately instead of
replaying an older `Available` badge. A connected computer that briefly stops
accepting new tasks is `Checking` while the bounded start wait can recover;
another current profile, provider, or permission blocker remains `Unavailable`.
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
- A local Agent Profile has a list of folders with one default; the Service
  mints folder ids, and the cloud holds only the path-free folder projection.
- A MemberAgent is unique per Organization, owner, and harness, stores no
  status, and is never a Space member, author, or mention target.
- The harness catalog report is the single source of MemberAgent existence.
  Only the default Agent Profile is created with its MemberAgent; every other
  Agent Profile needs explicit intent.
- A default Agent Profile's name is its harness display name and is not
  editable.
- An assigned Agent Profile cannot change harness; the controller switcher is
  only the assignment action for unassigned Profiles.
- Only the owner, as the root requester, changes Agent Profile settings,
  folders, permission mode, or concurrency limit.
- A Binding-wide controller conversation exists only for harnesses without
  Execution Context support; every context-enabled Session has its own native
  conversation.
- Default Project is an Organization-scoped preference for future local work,
  not a local path or permanent Agent Profile assignment.
- Reply recovery copy does not own readiness truth.
- Local agent selection must not merge Agent Profile identity with local
  execution infrastructure.
