# MemberAgent program

Status: design accepted by Felix on 2026-10-18; implemented in PR #236
(merged 2026-10-20) and enabled with `MEMBER_AGENTS_ENABLED` in PR #264.
This is the single reference for the local-agent restructuring. Implementers
and reviewers work from this document only. It supersedes the Chinese drafts
`local-agent-design-v4.md`, `local-agent-design-final-review.md` and
`local-agent-design-rollout.md` in Felix's Downloads folder.

Current behavior cited below is `amplifthq/openmeld@main` at `036bf6c67`.
Items marked **unverified** were not read line by line.

## How to use this document

- Implementing agent: take one work package from §10, read only the files it
  names plus the rules it cites, deliver into the program draft PR (§11), and
  stop at the package's acceptance line.
- Reviewing agent: check the diff against the cited rules, the authorization
  matrix (§6) and the invariants (§9). Anything not in this document is out of
  scope for this PR; owner-document rules still apply.
- Owner documents in `developing/` stay authoritative, as `AGENTS.md`
  requires. Phase 0 rewrites them in this PR before any implementation package
  starts. If this document and an owner document disagree after Phase 0, one
  of them is fixed in the same PR; this document never overrides an owner
  document.

## 1. Outcome

A member connects a computer and their Agents already exist: one per installed
harness, named after them ("Felix Lu's Claude Code"). Colleagues and other
Agents can use those Agents with the owner's knowledge and consent. Nothing in
this program adds a feature the accepted design does not have; it reorganizes
existing parts.

Principles that decide trade-offs:

1. Three layers, one job each. MemberAgent says whose harness; Profile says
   which configuration; Session says what is happening now.
2. Layers have different origins. MemberAgents are detected; Profiles are
   created on purpose (only the first is automatic); Sessions are unlimited.
3. A new model, folder or task never needs a new identity.
4. Skills and Plugins are shared resources, not Profile settings.
5. Every object is persisted; nothing is "inferred identity".
6. Humans and Agents use the same server operations with the same rights.
7. Private information is owner-only by default.
8. A person's Agent equals that person: same rights, no more, no less.
9. Only configuration and permission are server-enforced; everything else is
   the Agent's judgment, close to native Claude Code and Codex behavior.
10. The Agent knows the product better than the user and says so in context.
11. No cost on high-frequency paths. Safety appears only inside the risk
    window it protects.
12. **Extend existing UI; do not add parallel forms.** When an existing
    surface already does the job (inline-editable Profile cards, the
    Working folder control, chat history, sidebar rename/archive,
    `ApprovalCard` / `SpaceAgentInteractionCard`, banners, toasts, error
    notices), extend it. New surfaces only where the model is new: the
    MemberAgent row and its secondary sidebar of Profiles and Sessions.
13. **No dead ends.** Every page reached from Inbox, a request, a
    notification or a deep link has a visible way back to where the user
    came from; Session switching inside a MemberAgent is one click from the
    secondary sidebar and the chat header.

## 2. Vocabulary

| User-facing | Code | Meaning |
| --- | --- | --- |
| Agent | **MemberAgent** (`member_agents`) | One organization member's instance of one harness, e.g. Felix Lu's Claude Code |
| Claude Code, Codex, … | **Harness** (`harnessKind`) | The program kind that runs an Agent: one per builtin controller id (`claude-code`, `codex`, `grok-build`, `grok-bot`, `cursor`, `opencode`, `antigravity`, `openclaw`) plus `hosted` |
| Profile | Agent Profile (unchanged) | One configuration; still the Space member, message author and mention target |
| Chat | Session | One conversation: a Direct Message Space, or an Execution Context inside a group Space |

Why: `agent` already means Agent Profile, Local Agent, Remote Agent, Center
Agent and `agentControllerRef`. `MemberAgent` states ownership and separates
member-owned Agents from the organization-owned Center Agent. `Harness` is the
repository's existing word for Codex and Claude Code as programs
(`developing/clients/cli.md`, `developing/product/organizations-and-center-agent.md`);
it is not reused for the owned object because `AgentHarness` would give one
word three meanings. `harnessKind` maps one-to-one from
`agentControllerRef` (`packages/schemas/src/schemas/daemon/agent-controller-ref.ts`);
`controller` stays as a code name in this program.

Banned in new code and docs: "tool" for a harness; a bare `agent` table or
type for the owned object; `AgentHarness`; `PersonalAgent`.

## 3. Object model

```
Organization
└─ Member (display name = default Human Profile name)
   ├─ Computer × N  — each reports which harnesses it has installed
   └─ MemberAgent × one per harnessKind        ← new persisted object
        │  key: organization × owner × harnessKind
        │  exists while any of the member's computers has the harness; `hosted` is created manually
        └─ Profile × N
             ├─ default Profile: created with the MemberAgent, name = harness name
             ├─ other Profiles: created on purpose, e.g. "PR Reviewer"
             │    settings = existing Binding settings + one computer + folders (several, one default) + concurrency limit
             └─ Session × unlimited
                  title · request chain · Space · folder (fixed at first message) · working copy · state

Shared, outside the tree: organization/personal Skills and Plugins; Projects.
Organization-owned, outside the tree: Center Agent.
```

| Object | Owner | Persisted | Current implementation |
| --- | --- | --- | --- |
| Computer | member | yes | exists |
| Harness installation | computer | reported | exists (`developing/product/onboarding.md`, CLI Surfaces) |
| MemberAgent | member | **new** | none; Profiles are flat today |
| Profile | MemberAgent owner | yes | `openmeld_profiles` (Auth) + `openMeldDaemon_agent_profile_bindings` (Core) |
| Session | Profile; started by requester | yes | DM Space; Execution Context (`packages/schemas/src/schemas/protocol/execution-context.ts`) |

## 4. Rules

Each subsection gives the current state with its source, then the target.

### 4.1 MemberAgent

Current: identity lives in Auth `openmeld_profiles`
(`packages/db/src/auth/openmeld-profile.schema.ts`: `profileKind`,
`ownerUserId`, `organizationId`, `managedRole`, `isDefault`, `source`,
`lastUsedAt`). The harness lives in Core
`openMeldDaemon_agent_profile_bindings.agent_controller_ref`
(`packages/db/src/core/agent-profile-binding.schema.ts`), one
`enabled_primary` row per Profile. Controller ref kinds: `builtin`, `custom`,
`hosted:center-agent`, `hosted:remote-agent`.

Target:

- Table `member_agents` in **Auth**, same database as profiles: `id`,
  `organization_id`, `owner_user_id`, `harness_kind`, `default_profile_id`,
  `source` (`detected` | `migrated` | `manual`), `archived_at`, timestamps.
  Unique `(organization_id, owner_user_id, harness_kind)`.
  `openmeld_profiles.member_agent_id` nullable foreign key.
- **Existence follows the Local agents switch** (revised 2026-10-21). The
  member's choice is the Local agents switch of each connected computer: a
  harness that a computer reports as turned on (catalog `enabled`) and
  detected has a MemberAgent with its default Profile (named after the
  harness, not renameable) and the owner's DM. An installed harness that is
  turned off has none and is listed as addable. Setup's selection sets the
  switch: selected agents are turned on, every other detected agent is turned
  off before any Agent is added, so Tali choosing 3 of 6 still gets 3.
  Turning a harness on is adding it; the web My Agents Add action and
  `openmeld agent add` name the harness, and Core turns it on where it is
  installed before it creates the Agent. Turning it off, or uninstalling it,
  makes the MemberAgent read missing; nothing is deleted. Creation is
  idempotent (`auto:{organizationId}:{harnessKind}`) and adds no Inbox item.
  Members whose Agents were backfilled from Profiles get the missing
  turned-on harnesses on their next Agents surface open or catalog update; no
  backfill rerun is needed. History: the first design created an Agent for
  every detected harness; 9b924b6fb (2026-10-20) limited creation to the
  harnesses setup requested, which never covered members who did not run the
  new setup (Felix's Claude Code after the 2026-10-21 backfill). The switch
  rule keeps both promises.
- **No status column.** Presence and state are derived at read time from the
  Profiles' wakeability and computer online state. "Missing on every computer"
  flips only after the harness has been absent from several consecutive
  catalog reports or for several minutes (debounce), so a PATH hiccup or an
  upgrade never greys the Agent.
- Display name `Felix Lu's Claude Code` is derived by the client from the
  owner's default Human Profile name plus `formatLocalAgentDisplayName`
  (`clients/web/src/components/profiles/local-agent-display-name.ts`). English
  only. Never stored.
- `harnessKind` for `custom` controllers is undefined: those Profiles stay
  unassigned (§4.11). `hosted:remote-agent` maps to `hosted`. Center Agent
  (`hosted:center-agent`, null owner) is outside the structure.
- Remote Agents are MemberAgents with `harnessKind = hosted`, `source = manual`.
- Nothing configurable lives on the MemberAgent in this program. Later
  candidates: shared Profile defaults, sharing policy, usage budget, shared
  memory.
- Space participants remain Profiles. MemberAgent is a grouping, never an
  author.

### 4.2 Profile

Current: Binding holds `openMeldServiceRuntimeId`, `modelId`,
`reasoningLevel`, `agentControllerPermissionMode`,
`agentControllerCollaborationMode`, `openCodePermission`. `profile_name` is
NOT NULL; `profile_handle` unique per owner. Creation proposes
`buildAgentProfileTemplateName`
(`clients/web/src/components/profiles/create-profile-dialog.tsx:1053`). A
controller switcher exists (`developing/product/agent-profiles.md`, Shared
provider conversations). Binding carries `agentControllerConversationId`. Context-enabled Profiles
already run independent Execution Contexts (`developing/decisions.md`,
2026-09-14); only harnesses without context support still keep the Binding
conversation (`execution-context-authority.ts:410`). Per-Profile concurrency is the constant
`AGENT_PROFILE_WORK_CONCURRENCY_LIMIT`
(`clients/openmeld-cli/src/local-service/carrier/local-execution-slots.ts:19`).

Target:

- Settings are the existing ones plus **folders** (§4.4) and an adjustable
  **concurrency limit** stored on the Binding and read by the Service from the
  route catalog.
- One Profile runs on one computer (already true).
- **A Profile cannot change harness.** The controller switcher is hidden for
  assigned Profiles and kept only for unassigned ones as the way to assign them.
- The default Profile's `profile_name` starts as the harness display name.
  As revised on 2026-10-27, owners can rename default and additional Profiles.
  Display: `Felix Lu's Claude Code · PR Reviewer`; only a default Profile still
  using its harness display name shows no suffix. Harness sync preserves renames.
  Handle rules unchanged. The long template is no longer used for defaults.
- `agentControllerConversationId` on the Binding remains only for harnesses
  without context support and for `legacyAssociation`. Every context-enabled
  Session carries its own native conversation; the owner-document sentence
  about a Profile-wide conversation is rewritten to say exactly that.
- Only the owner changes settings, including permission mode, enforced by the
  root-requester rule (§4.6).

### 4.3 Session

Current: Execution Contexts are keyed by
`scopeKey(targetProfileId, organizationId, requesterProfileId, spaceId, threadId)`
(`services/core/src/runtime-transport/application/execution-context-authority.ts:139`).
Center Agent sessions are multiple DM Spaces sharing one `pairKey`
(`services/core/src/center-agent/application/center-agent-session-list.ts`;
schema `packages/schemas/src/schemas/http/center-agent-direct-message-space.ts`;
space index columns `direct_message_pair_key`, `center_agent_profile_id`;
sidebar lane `dm.sessions` in
`clients/web/src/components/spaces/conversations-sidebar.tsx:168`). Ordinary
DMs are get-or-create. Title generation runs only for the designated pair.
Rename, archive and delete are future even for Center Agent. Requesters can
only resolve their own context
(`services/core/src/runtime-transport/application/agent-profile-execution-admission.ts:847`).

Target:

- In a Direct Message, a Session **is** a DM Space. New Chat creates another
  DM Space with the same `pairKey`. Generalize Center Agent session create and
  list from "designated pair" to any agent Profile's DM. The scope key is not
  changed.
- In a group Space, a Session is the Execution Context. "Continue in another
  folder" is the existing `mode: "fork"` with new preferences.
- Title generation keeps its model, budget and three-attempt cap; the trigger
  widens to agent DM sessions.
- Rename, archive and delete are new operations; Center Agent sessions gain
  them too. No automatic archiving.
- Owners continue or fork their own Sessions; colleagues continue only their
  own and always start fresh. Sharing a Session is later work.
- **Harnesses without Execution Contexts** (for example OpenCode) keep one
  Binding conversation. A Wake whose root requester is not the owner never
  resumes that conversation: it starts a new native conversation and does
  not write its id back to the Binding, so a colleague never sees the
  owner's history and the owner's next task does not continue the
  colleague's. Decided by the designer on 2026-10-19 (privacy by default).

### 4.4 Folders

Current: the local envelope `ProfileLocalMetaEnvelope` v2 stores one
`workspace` (managed or custom path) per Profile
(`clients/openmeld-cli/src/profile-workspace/service.ts`), under the lock
`profile-workspace-config`. The cloud stores only `defaultProjectId`.
Execution Context preferences are `access`, `workspace`, `projectWork`. A
missing folder fails closed with "choose again"
(`developing/product/projects.md`). `workspace: "isolated"` with
`runtimeWorkspaceFingerprint` is the worktree copy.

Target:

- Envelope v3: `folders: [{ id, kind, path | projectId, displayName }]` and
  `defaultFolderId`. **The Service mints folder ids.** v1/v2 envelopes read as
  a one-element list.
- Cloud projection `(profileId, folderId, kind, displayName)` written by Core
  when the Service reports a folder save. The folder projection and every
  folder operation carry no path; a failure about a selected folder reports a
  reason code, never the path. No path is stored in the cloud or shown to
  anyone but the owner; the existing owner-self transit of a path through
  Core to the owner's own Web session (Project folder picker) is unchanged,
  and the pre-existing `effectiveRuntimeWorkingDirectory` in dispatch results
  stays owner-only diagnostics (open item, §13). A cloud id unknown to the
  local envelope takes the existing fail-closed path. The envelope carries a
  Service-local `foldersRevision`; Core keeps the highest revision so a late
  receipt never restores an older list.
- Preferences gain `folderId`. Core strips `folderId` when the root requester
  is not the owner, so colleagues always use the default folder.
- Resolution order: explicit choice → inherited from the continued or forked
  Session → Profile default → OpenMeld-managed folder.
- Agents choose folders by id and display name only.
- Direct edit versus isolated copy: unchanged semantics; §4.9 covers two
  Sessions in one folder.

### 4.5 Lifecycle

Current: the Service reports its harness catalog continuously. The invariant
"ordinary Agent Profile creation requires explicit intent"
(`developing/product/agent-profiles.md`) exists. Idempotency uses
`creationIdempotencyKey`. Private chats must not publish welcome messages
(`developing/product/space-collaboration.md`).

Target:

- The catalog report is the single source for MemberAgent state; the member's
  choice, the Local agents switch it reports (§4.1), decides existence.
- Creation: for every harness a reporting computer has turned on and detects
  **in the current organization** when the member has no MemberAgent for it,
  Core asks Auth to create the MemberAgent and default Profile with the
  deterministic idempotency key `auto:{organizationId}:{harnessKind}`, writes
  the Binding (which assigns the Profile under the assignment lock), and opens
  the owner's DM. The unique key's conditional insert makes two simultaneous
  computers and repeated syncs safe. Installed, turned-off harnesses are
  reported as addable, never created. Setup turns its selection on and the
  other detected agents off (through the Service, which refreshes its report
  at once) before it syncs. A request naming a harness (`createHarnessKinds`:
  setup, web Add, `openmeld agent add`) turns an installed, turned-off one on
  there first; a refused switch comes back as the result's reason code.
  Shared-account harnesses wait for a chosen conversation.
- **Per organization.** Sync runs when the member opens an organization's
  Agents or DM surface, when a harness is turned on from OpenMeld Web, and on
  a catalog update that shows a harness the previous report did not detect
  (installed, reinstalled, or turned back on). A catalog update reconciles
  every organization where the owner already has a non-archived MemberAgent,
  including migrated ones; it never broadcasts to every organization on
  connect. Every sync also finishes interrupted creations and assigns bound
  Profiles.
- Rewrite the explicit-intent invariant: the default Profile is created with
  the MemberAgent; every other Profile still needs explicit intent. Add
  `auto_detected` to the Profile `source` enum.
- Uninstall: after debounce, the MemberAgent reads as missing, moves to an
  "unavailable" sidebar group, keeps Profiles, Sessions and history. After 30
  days the owner gets a manual Archive action. Nothing is deleted
  automatically. Reinstall restores the same object.
- Second computer: no new MemberAgent; detail shows the computer and offers a
  Profile there. Forgotten computer: its Profiles become unreachable; state
  follows the remaining computers. Owner leaves the organization: existing
  departure rules apply; nothing is reassigned.
- Welcome and repair cards are a **presentation surface**, as Center Agent
  introductions are, not messages. One card per problem, updated in place.
  The welcome card adds one line about the permission mode (§4.8).

Worked example, Felix with a MacBook (Claude Code, Codex, Grok Build) and an
iMac (Claude Code). Separately, Tali's setup selects 3 of 6 detected harnesses:
the other 3 are turned off, so she gets 3 MemberAgents and 3 addable rows.
And an existing member whose backfilled Profiles never bound Claude Code, with
Claude Code turned on: opening Agents adds Claude Code with its DM.

| Day | Event | Result |
| --- | --- | --- |
| 1 | MacBook connects, setup keeps all three on, Felix opens Agents | three MemberAgents, each with a default Profile and DM |
| 2 | Felix turns Codex off in Local agents | Codex reads missing, greyed, history kept |
| 2 | Felix turns Codex back on | same MemberAgent returns; nothing new |
| 3 | iMac connects | Claude Code gains a computer; nothing new |
| 10 | Grok Build uninstalled | Grok Build reads missing, greyed, history kept |
| 12 | Claude Code upgrades, briefly absent from one report | debounce holds; no change |
| 30 | Cursor installed (the Service turns it on) | new MemberAgent, "ready" card |
| 31 | OpenCode installed, Felix turns it off before the next report | listed under "Found on your computers" with Add; no MemberAgent |
| 32 | Felix clicks Add on OpenCode | Core turns it on on the MacBook, then a new MemberAgent and DM |
| 45 | Grok Build reinstalled | same MemberAgent returns with its Sessions |
| 60 | iMac forgotten | iMac Profile unreachable; the MemberAgent stays available via MacBook |

### 4.6 Colleagues, external users and the root requester

Current: any member can open a DM with another member's Agent. Adding another
owner's Agent adds the owner as a full member atomically
(`packages/space/src/membership/profile-add-plan.ts`; rule in
`developing/product/space-collaboration.md`, Agent Owner Participation). The
owner-observer exists only for one-to-one DMs
(`services/core/src/space/transport/do/space.ts:14164`,
`isAgentOwnerObserver`). Permission questions go only to the Binding owner
(`services/core/src/runtime-transport/application/runtime-coordinator-authority.ts`);
they enter the Inbox as `importance: "normal"`
(`runtime-coordinator-interaction-inbox-producer.ts:75`); urgent email
requires `importance = urgent` plus the preference
(`inbox-email-delivery-service.ts:289`). The requester is one hop:
`requesterProfileId` in scope; Center Agent `onBehalfOf`
(`packages/schemas/src/schemas/http/center-agent.ts:248`); Remote Agent
`delegated-requester.ts`; child Wakes via `agent_delegate_task`
(`packages/schemas/src/schemas/daemon/runtime-transport.ts:2140`); Routines
use `actorContext.openMeldProfileId`
(`services/core/src/routines/routine-request-preparation.ts`, unverified
whether this is the creator). `spaceCallerContext.relationship` distinguishes
`internal`, `external`, `anonymous`, `agent`, `system`.

Target:

**Root requester rule.** Every Wake has exactly one human root requester.
No human root, no Wake.

| Trigger | Root requester |
| --- | --- |
| A person posts, mentions or DMs | that person |
| Routine | its creator; the Routine stops when the creator leaves the organization |
| Identified external user | that user; may be a root, but every use needs the owner's consent and "always allow" is not offered |
| Anonymous visitor | no identity, rejected at the entrance |
| System | none today; a future system trigger must name a human, e.g. the admin who enabled it |

**Request chain** = `[root human, optional source marker (e.g. routine),
Agent, Agent, …]`. Written by the server at Wake time; Agents cannot write or
edit it; propagation only appends. It is the projection of the existing
delegation chain plus the root, not a second store, and replaces
`onBehalfOf`. Stored on the Execution Context **assignment**, not in the scope
key. A maximum depth is enforced, never stricter than the existing
`autoRelayDepth` thresholds. Repeat rejection applies only to **delegated
work** (`agent_delegate_task`, Center Agent delegation): an Agent cannot
re-enter a chain that delegated to it. Conversational Space auto-relay Wakes
keep the human root, append to the chain and are never hard-blocked, per the
Auto-Relay Loop Policy in `developing/architecture/agent-transport-contract.md`.

**Three situations.**

| Situation | Owner asked? | Flow |
| --- | --- | --- |
| Group Space where the Agent is already a member | no (exception: external root requester, each time) | any member mentions it |
| First DM from a colleague to a Profile | first time | below |
| Mention or Add-member in a Space the Agent is not in | request to owner | below |

First DM: the colleague's first message shows "Waiting for Felix"; the owner
receives an urgent Inbox item and email with **Allow once / Always allow
<colleague> for this Profile / Decline** (external users: Allow once /
Decline). Approval always starts a new Session for the colleague. Grants are
recorded per `(grantee, Profile)` with `granteeKind member | external`,
revocable; a colleague's Agents inherit the colleague's grant. The owner is a
read-only observer and may Join, which converts the DM (existing behavior).

Bringing the Agent into a Space: **the owner adding their own Agent keeps the
current atomic join.** Anyone else mentioning or adding it creates a request
bound to the message id (edited or deleted message voids it); the Agent is
not woken and not added; the owner becomes a read-only observer of that Space
and chooses **Add to Space / Don't add**; **Message <requester>** opens the
owner's DM with the requester and leaves the request pending. The observer
condition widens from "current DM" to "ordinary Space containing an Agent I
own or a pending request for one". Observers are not members, so the
"owner cannot leave before the Agent" rule does not apply to them.

Permission questions ("ask first" modes): only the owner can answer. When the
root requester is not the owner the Inbox producer writes `urgent`, so the
existing email channel fires; emails are **coalesced per Session** by
`contextId`, later questions update the same item without a new email. The
Inbox item renders the existing `SpaceAgentInteractionCard` with the harness's
native options plus Open conversation; answering anywhere closes it
everywhere. The requester sees only "Waiting for Felix to approve a command"
and may cancel. Timeout stays `AGENT_INTERACTION_DEFAULT_TIMEOUT_MS` (8 h).

Server-enforced operations (root requester must be the owner): change
settings, folders, permission mode or concurrency; answer approvals; delete;
add the Agent to a Space; grant or revoke access; archive. Current
owner-of-actor checks become root-requester checks: owner validation with
`agent_profile_binding.owner_mismatch` on Binding reads and disables
(`services/core/src/rpc/methods.ts:5656-5669`, `:6566-6578`), execution-target
mutation admission on Binding settings writes such as
`rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode`
(`methods.ts:19551`), and `isSpaceOwner` on member removal
(`space-member-management-policy.ts`). Everything
else is prompt guidance: each task prompt states the chain, the root
requester, where results go and who can see them.

### 4.7 Credentials

Current: the owner's login token is in the keychain
(`sh.openmeld.auth.token`, `clients/openmeld-cli/src/config/token-store.ts`);
the Service and the Agent run as the same OS user, so an Agent can run the
real `openmeld` CLI. Task-time Space actions go through the injected
`openmeld` stand-in using a 12-hour local context file
(`clients/openmeld-cli/src/runtime/dispatch-space-action-context.ts`), which
can only perform Space actions (`openMeldSpaceEgressActionSchema`).

Target:

1. Tasks receive a **task credential**: the execution's existing
   RuntimeCoordinator execution token, retired when the execution ends. It is
   bound to the request chain, not a copy of it: Core reads the root from the
   execution's accepted assignment. Core verifies it only at the
   sensitive-operation boundary; other calls ignore it.
2. Sensitive operations (§4.6 list) accept only a task credential whose root
   is the owner, or the owner's own App or Web session.
3. A sensitive operation made with the **CLI login credential**, or with an
   owner-rooted task credential, passes unless **the owner currently has any
   active task in this organization whose root requester is not the owner**;
   only then the server sends the owner a confirmation card through the
   Inbox. The window is owner-wide, not per computer: Core cannot bind a CLI
   call to a computer without trusting the caller, and another task of the
   same OS user can read an owner-rooted credential (decision 5a0). Ordinary terminal use is never interrupted. A TTY elevation cache
   is not built unless this card turns out to be frequent.
4. Every sensitive operation is written to the audit log.
5. Other secrets on the computer (SSH keys, harness logins, browser data) are
   not protected by OpenMeld; that is what "run any command" means natively.
   When an owner grants a colleague a full-access Profile, the UI says so once.
6. The Desktop app opens no local port and reaches Core with its own
   interactive session, like Web; CLI commands it runs are classified as the
   CLI credential.

### 4.8 Permission-mode advisor

New, first phase, prompt-only:

- Core counts, per Profile over a window (seven days), permission questions
  raised by tasks whose requester is not the owner. Phase 1 uses the existing
  one-hop `requesterProfileId`; Phase 3 switches to the root requester. Over a
  threshold (three) the Profile carries an advisory flag.
- The flag is injected into the owner's next task prompt for that Profile and
  into Center Agent guidance. The Agent says, in context: "Tali used this
  Profile five times this week and each run waited for your command approval;
  switch to acceptEdits?"
- If the owner agrees, the Agent calls the existing permission-mode write; the
  root-requester check already restricts it to the owner.
- Guardrails: suggest only, never change silently; at most one suggestion per
  Profile per week; suggest the harness's next less-interrupting mode (Claude
  Code: acceptEdits or auto; Codex: Approve for me), never bypassPermissions
  by default.
- The welcome card carries one line: the mode is "ask first", good for
  personal use; the Agent can switch it later if colleagues use it.

### 4.9 Concurrency

Current: `resourcesConflict`
(`runtime/local-service/src/local-execution-slots.ts:3`) treats `exclusive`
as conflicting with every other task machine-wide, `none` included, and
treats an undefined legacy scope as conflicting with any defined one (since
the 4e acceptance fix, only when the folders are the same or either is
unknown: tasks without an Execution Context now also get a `folderKey`);
`resourceScope` derives
from access and workspace (`execution-context-session.ts:34`). Limits:
`DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY = 10`,
`DEFAULT_RUNTIME_DAEMON_QUEUE_MAX = 50`
(`clients/openmeld-cli/src/config/runtime-config.ts:120`),
`LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT = 1`. Selection `mode: "auto"` lets
the Service pick the workspace.

Target:

- `resourceScope` gains a `folderKey` (fingerprint of the resolved path).
  Conflicts exist only within one folder. Two direct-edit Sessions in the same
  folder run concurrently; the later one gets a `shared_folder` notice with a
  one-click switch to an isolated copy, and each task prompt lists the other
  Sessions editing that folder.
- Tasks from non-owners default to an isolated copy when the folder is a git
  repository. Core resolves `mode: "auto"` and does not send the request chain
  to the Service, so Core marks the task `workspaceDefault: "isolated_if_git"`
  when the root is not the owner and the selection is the implicit default;
  the Service checks for git, chooses, and reports the chosen workspace in the
  completion, which Core persists (`executionContextVersion` 7; older
  Services keep today's behavior).
- Queue diagnostics name the folder and the waiting reason. Per-Profile and
  per-computer limits stay constants in this program
  (`AGENT_PROFILE_WORK_CONCURRENCY_LIMIT = 5`,
  `DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY = 10`); making them
  owner-adjustable needs a Binding migration and Web, and is a follow-up
  package. FIFO, no priorities; owner and colleagues share the Profile's
  limit.
- The visible `shared_folder` notice with a one-click switch to an isolated
  copy needs Core, Space and Web; it is a follow-up after Phase 4. Phase 4e
  delivers the folder-scoped conflict rule and the prompt list of other
  Sessions in the folder (without paths).

### 4.10 Visibility

Current: the non-owner projection shows controller, model, reasoning,
collaboration mode, permission mode, the four wakeability states and the
single structured exception `usage_exhausted`
(`developing/product/agent-profiles.md`, Operational Context).

Target: the exception becomes an enum of reasons visible to organization
members: `not_signed_in`, `no_subscription`, `org_disabled`,
`version_too_old` (with the unsupported model), `computer_offline`,
`usage_exhausted` (with reset time when known). Quota numbers, subscription
tier, account identity, paths, command text, raw diagnostics, grants and
audit stay owner-only. Computer names stay out of the MemberAgent non-owner
projection; the existing People/Computers directory is a separate shipped
surface and is not changed by this program.

### 4.11 Management

- Agents list: one row per MemberAgent with state, running and queued counts,
  latest Session. Built on `PeopleAndAgentsPage`
  (`clients/web/src/components/agents/person-agents-page.tsx`), which already
  has owner grouping (`sortAgentOwnerGroups`,
  `clients/web/src/components/agents/agent-list-model.ts`).
- MemberAgent detail: summary; secondary sidebar of Profiles, each listing its
  Sessions with requester, Space and state filters.
- Profile settings: existing settings plus computer, folders, concurrency
  limit, granted colleagues (revocable).
- Sessions: rename, archive, delete, fork, continue in another folder.
- Unassigned Profiles: only two migration cases cannot be grouped, Profiles
  that never bound and Profiles bound to a `custom` controller. Disabled
  Bindings still group by their last Binding's harness and read as missing.
  Unassigned Profiles sit in their own section at the bottom of the list with
  the controller switcher as the assignment action. The system never guesses.
- CLI: keep `openmeld profile create/list/show/set/update/delete`
  (`clients/openmeld-cli/src/commands/profile.ts:3394`) and print the parent
  MemberAgent; add `openmeld agent list/show`; add Session list, rename,
  archive.
- Center Agent management operations gain: set default folder by id, archive
  Sessions, handle access requests, change permission mode. All check the root
  requester and follow red line 8 in
  `developing/product/organizations-and-center-agent.md` (Drift Control): the
  Center Agent acts only on the verified speaker's explicit instruction in the
  current turn, never autonomously. Archive and permission-mode changes are
  non-additive, so they also need that explicit instruction plus a
  confirmation, as Routine management does.

## 5. Mention and Profile selection

Mentioning an Agent in a group Space uses **the Profile that is a member of
that Space**. If none is, the default Profile is used and auto-joins (owner's
own mention) or a request is created (anyone else, §4.6). If two Profiles are
members, the mention must name one. No "last used in this Space" state is
stored.

## 6. Authorization matrix for sensitive operations

| Operation | Current check | Where | Target check |
| --- | --- | --- | --- |
| Binding settings write (model, reasoning, permission mode, collaboration, OpenCode permission) | owner validation + execution-target mutation admission | `rpcUpdateAgentProfilePrimaryBindingAgentControllerPermissionMode` `methods.ts:19551`; `rpcUpdateAgentProfilePrimaryBindingOpenCodePermission` `:19794` | root requester owns Profile |
| Binding create / rebind / disable | owner validation (`agent_profile_binding.owner_mismatch`) | `rpcEnsureAgentProfilePrimaryBinding` `:19334`; `rpcDisableAgentProfilePrimaryBinding` `:6557` | root owns; rebinding an assigned Profile to another harness is refused (§4.2) |
| Creation defaults for future Profiles | owner | `rpcSetAgentProfileCreationDefaults` `:6710` | root owns |
| Center Agent runtime-settings write | verified human speaker owns Profile | `rpcCenterAgentUpdateAgentProfileRuntimeSettings` `:12770` | same via chain root; explicit instruction in the current turn only (red line 8, §4.11) |
| Working folder write | owner Service lane; Binding target fence only when a target is supplied (`:4867`), required by the bound wrapper (`:4916`) | `methods.ts:4743-4931` | add `folderId`; stripped for non-owner roots (Phase 2 uses the one-hop requester) |
| Default Project write | owner; optional target fence | `rpcUpdateAgentProfileDefaultProject` `:1489`; bound variant `:1521` | root owns |
| Local envelope write on the computer | Service-local, no Core check | `clients/openmeld-cli/src/profile-workspace/service.ts:280` | unchanged: owner-machine local state (§4.7 item 5); the Service stays the only writer |
| Add Space members | Space owner for direct adds; invitation acceptance; organization self-join | `rpcPostMembers` (`methods.ts:2280`); `rpcAcceptSpaceInvitation` (`space.ts:12456`); self-join (`space.ts:19101`) | owner adding own Agent unchanged; anyone else adding someone's Agent → request path; invitations and self-join never add another owner's Agent |
| Remove members / leave | Space owner (`isSpaceOwner`, `space-member-management-policy.ts`); self for leave (`space.ts:13167`) | | unchanged |
| Space ownership, access policy, password | Space owner | `space.ts:13203` | unchanged |
| Answer agent interaction | Binding owner | `runtime-coordinator-authority.ts`; `rpcRespondToAgentInteraction` (`methods.ts:2249`) | unchanged; requester-side cancel added |
| Work-recovery approval (skip or approve queued work) | owner shard + `ownerUserId` | `rpcExecuteAgentProfileWorkRecovery` `:5841`; `executeAgentProfileWorkQueueApproval` `:6039` | root owns |
| Delete Profile / Space | owner / Space owner | existing | root owns |
| Prepare Organization member removal (close, demote, transfer Spaces) | current human Organization owner/admin with `member:delete`; exact non-owner target membership; Space-owned reviewed plan | `GatewayRpcEntrypoint.prepareOrganizationMemberRemoval`, `organizations/member-removal.ts` | root owns the administrator's credential; interactive Web/App session passes, CLI/task credential uses the owner-wide risk-window confirmation; target member need not participate |
| Grant, revoke, archive | new | — | root owns; archive is non-additive and needs an explicit instruction |
| Space actions from a task | task context file + execution token | `dispatch-space-action-context.ts` | task credential with chain |

Until Phase 5, ordinary §6 endpoints authorize the signed-in account; a
Web, App or CLI session is its own root, so those checks are the root check
for them. The remaining gap is a colleague-rooted task running the owner's
real CLI, which Phase 5a–5c close. Hosted Center and Remote Agent Wakes have
no Execution Context assignment; their management calls are root-checked at
the tool boundary instead of at admission.

Phase 5 also gates: Direct Message Session archive and delete, Agent
Profile deletion through Auth, adding the caller's own Agent to a Space,
Space deletion, agent access decisions and revoke, execution mode writes,
and audits the Center Agent runtime-settings write with source
`center_agent`. Every gated operation writes an audit row
(`sensitive_operation_audit_events`, migration 0046).

Implementers extend this table in the PR when they touch an operation not
listed; reviewers reject sensitive writes that check only the immediate actor.

## 7. Request flows

**First DM from a colleague.** Tali opens a DM with `PR Reviewer` → Core
creates the DM Space in `pending_owner_consent` → Tali's message is stored,
not dispatched → Inbox item (urgent) + email to Felix → Felix answers in Inbox
→ grant recorded (`always`) or not (`once`) → Core creates a fresh Execution
Context for Tali and dispatches → Felix observes read-only. The request keeps
Felix's `decision` for good; the grant keeps its own lifecycle. If Felix later
revokes an `always` grant, Tali's state is `revoked` (**Access removed**) and
her next message asks again. `allow_once` covers only that DM; a new DM
starts unsent.

**Bringing an Agent into a Space.** Tali mentions `Felix Lu's Claude Code` in
Space S → message posts; mention chip shows "Requested Felix"; no Wake →
request `(space S, message M, agent)` stored on the MemberAgent → Felix gains
observer access to S; Inbox item + email → Felix chooses Let the Agent join →
default Profile joins S; Core dispatches message M with chain
`[Tali, Felix Lu's Claude Code]` → if M was edited or deleted, the request is
void and Tali sees it.

**Colleague task hits "ask first".** Harness asks to run `pnpm test` →
Service forwards the interaction → Core sees root ≠ owner → Inbox producer
writes `urgent`, keyed by `contextId` → email once per Session → Felix answers
in Inbox with the native option → Service resumes → Tali's view shows
"Running" again. Timeout 8 h ends the task with an explicit reason.

**Managing access afterwards.** Felix opens the DM (or the group Space) →
Members → **Agent access** → Tali's row shows her rule (**Always allowed**,
**This chat only**, **Waiting for you**, **Declined**, **Access removed**) →
Felix upgrades a member to **Always allowed** or removes access from the
row's menu; removing an `always` grant asks once, because it covers every
chat with that Profile. Tali sees the same
row read-only, with **Withdraw** while it waits and **Ask again** after a
decline or removal. The Agent detail page lists the same rows and links each
Space with **Manage in <Space>**
(`?panel=members&section=agent-access&highlight=<entryId>`). Detail:
`developing/product/space-collaboration.md`, Agent access list.

## 8. Data, migration and rollback

- Migrations live in `packages/db/postgresql/migrations` (latest `0192`).
- `member_agents` is additive; `openmeld_profiles.member_agent_id` is
  nullable. Backfill groups Profiles by
  `(organization_id, owner_user_id, harnessKind of enabled_primary or latest
  Binding)` and sets `default_profile_id` to the most recent `lastUsedAt`.
  Unassignable Profiles keep `member_agent_id = null`.
- The backfill is idempotent and prints counts (created, grouped, unassigned
  by reason). Pre-launch data is small; no separate dump analysis is required,
  the counts from the staging run are the record.
- Production runs it through `cutover.mjs backfill-member-agents`, after a
  `--dry-run` preview whose counts the owner approves. The flag launch shipped
  without it, so every existing Profile read as unassigned until it ran.
- Migration `0047` adds `agent_access_requests.decision` and backfills it
  from the status and the grant each request wrote: an `always` grant is
  `always_allow`, a `once` grant or an allowed request without a grant is
  `allow_once`; declined, joined and ignored map to their answers. Withdrawn
  requests and requests void before an answer stay null.
- Rollback per phase: a feature flag hides MemberAgent surfaces; the column
  stays nullable; projections (presence, folder index) are recomputable.
  Phase 1 ships behind the flag and can be disabled without a migration.
- Persisted compatibility, not only visibility: envelope v3 keeps the v2
  `workspace` field mirroring the default folder, so an older Service still
  resolves it; invariant 4 applies only to contexts accepted after Phase 3 is
  enabled, older contexts keep an empty chain and are treated as owner-rooted
  legacy; session DM Spaces are ordinary DM Spaces, so with the flag off they
  simply list as DMs. Each phase names its compatibility test in its
  acceptance line.

## 9. Executable invariants

Add as SQL assertions run after migration and as property tests where a
writer exists:

1. Every active, unmanaged Profile with an `enabled_primary` Binding of a
   builtin or `hosted:remote-agent` harness has exactly one
   `member_agent_id`. Managed Profiles (Center Agent, legacy
   `openmeld_assistant`) are excluded; they stay outside the structure and
   hidden from the Agents home.
2. No two `member_agents` rows share `(organization_id, owner_user_id, harness_kind)`.
3. Every `member_agents.default_profile_id` points to a Profile whose
   `member_agent_id` is that row.
4. Every accepted Execution Context has a non-empty request chain whose first
   element is a human Profile (Phase 3 onward).
5. No `member_agents` row is created by a trigger other than catalog sync,
   migration or explicit manual creation (`source` is one of three).
6. A folder id present in the cloud projection but absent locally yields the
   fail-closed outcome, never a substituted path (Service test).

## 10. Work packages

All work lands in the single program draft PR (§11). Dependencies:
Phase 1 → Phase 3 → Phase 4; Phase 2 is independent; Phase 5 is last. Within
a phase, packages marked ∥ may run in parallel in separate sub-sessions as
long as they touch different files; packages marked → are serial.

### Phase 0 · Documents (serial, first)

- `developing/decisions.md`: add the 2026-10-18 entry pointing to this
  program.
- `developing/product/agent-profiles.md`: MemberAgent layer and vocabulary;
  default Profile name = harness name; no harness change; explicit-intent
  invariant rewritten; Working Folder one → many; Operational Context reason
  enum; invariants list.
- `developing/product/space-collaboration.md`: Agent Owner Participation
  (observer widening, request path, owner self-add unchanged); Direct
  Messages (sessions by pairKey for agent DMs, titles, rename/archive/delete);
  Human Input (urgent + coalescing).
- `developing/product/inbox.md`, `inbox-actions.md`: kinds
  `agent_access_request`, `agent_space_request`, `credential_confirmation`;
  urgency from root requester; per-Session coalescing.
- `developing/product/projects.md`: folder sources and folderId.
- `developing/clients/cli.md`: agent commands; task credential; risk-window
  confirmation.
- `developing/product/organizations-and-center-agent.md`: Vocabulary Seeds
  add MemberAgent and Harness; Center Agent management operations; advisor
  guidance.
- `developing/architecture/agent-transport-contract.md`: request chain on the
  assignment; `folderKey` in resource scope.

Acceptance: docs lint passes; no owner doc contradicts §4.

### Phase 1 · Objects and navigation

| Pkg | Scope | Files (start points) | Acceptance |
| --- | --- | --- | --- |
| 1a → | `member_agents` table, `member_agent_id`, `auto_detected` source, feature flag | `packages/db/src/auth/*.schema.ts`, migrations, `packages/schemas` | migration idempotent; invariants 2–3 as SQL |
| 1b → | backfill by harness; default by `lastUsedAt`; unassigned report | Auth service, migration script | staging run prints counts; invariant 1 |
| 1c ∥ | catalog-sync creation (Core → Auth), lazy-per-org rule, deterministic idempotency key; derived presence with debounce in the read projection; presentation cards | `services/core/src/agent-profile-binding/application/*`, `services/core/src/agent-profile/application/*`, readiness projection | two computers → one MemberAgent; upgrade blip does not grey |
| 1d ∥ | Web: Agents list per MemberAgent, detail, unassigned section; DM sidebar one row per MemberAgent with sessions by pairKey; English display names; Session rename/archive/delete | `clients/web/src/components/agents/*`, `components/spaces/conversations-sidebar.tsx`, `use-conversations.ts`, Center Agent session RPCs widened | no existing Profile disappears for a migrated user |
| 1e ∥ | Permission-mode advisor: counter on one-hop requester, flag, prompt injection, Center Agent guidance | interaction inbox producer, prompt template assembly, Center Agent guidance | three colleague approvals → one suggestion in the owner's next task; none again within a week |
| 1f ∥ | CLI `openmeld agent list/show`; Session list/rename/archive | `clients/openmeld-cli/src/commands/*` | — |

Not touched in Phase 1: authorization basis, credentials, folders, colleague
flows.

### Phase 2 · Folders (independent)

2a → envelope v3 with Service-minted ids; 2b → cloud folder projection;
2c → `folderId` in preferences, composer picker, Center Agent set-default by
id, "continue in another folder" = fork + folderId. Non-owner stripping in
Phase 2 uses the one-hop `requesterProfileId`; Phase 3 switches it to the
root. Acceptance: invariant 6; a v2 envelope reads as v3 and an older Service
reads the v3 default; the Service is the only envelope writer the tests
exercise.

### Phase 3 · Request chain and enforcement

3a → `requestChain` on the assignment; producers
(`accepted-dispatch-snapshot.ts:49`, `space.ts:5488`, plugin callers,
Routines, delegate inheritance); depth cap and delegation re-entry check
(conversational auto-relay is never blocked); 3b → Center Agent
non-additive writes (permission mode, archive) require Core-bound
confirmation evidence tied to member, target and input, not prompt guidance
alone; sensitive
operations check the root (matrix §6); 3c → Inbox producer `urgent` for
non-owner roots with per-`contextId` coalescing; advisor counter switches to
the root. Acceptance: Tali's Center Agent cannot change Felix's Profile and
the audit shows the chain; ten questions in one Session send one email; a
Routine stops when its creator leaves.

### Phase 4 · Colleague use

4a → grants table, pending-consent DM state, Inbox request kinds; external
"allow once" path; anonymous rejection; 4b → mention/add → request; owner
self-add unchanged; message-id binding; 4c → observer widening; 4d → revoke;
4e ∥ non-owner default isolated for git folders; `folderKey` conflicts and
`shared_folder` notice. Acceptance: no Wake and no membership before consent;
observer reads but cannot write; revoked grant blocks new tasks while running
ones finish; external users are asked every time.

### Phase 5 · Credentials (last)

5a0 → define the risk-window contract: how Core identifies the calling
computer of a CLI-credential request (device or daemon session) and reads that
computer's active tasks with their roots; if a per-device read is not
available, fall back to "any active non-owner-rooted task for this owner in
this organization", coarser but enforceable; 5a → task credential with chain,
verified by Core; 5b → sensitive operations
accept task credential (owner root) or App/Web session; 5c → CLI credential
on a sensitive operation: confirmation card only while this computer runs a
non-owner-rooted task; 5d → audit log for every sensitive operation.
Acceptance: a colleague-rooted task running the real `openmeld` CLI produces
a confirmation card, not a change; the owner's terminal with no such task is
uninterrupted.

## 11. Execution protocol

- **Roles.** Felix accepts. Claude (this session) designs, splits packages,
  dispatches and reviews; it writes no implementation code. Opus 5.5
  sub-sessions implement packages. Codex (`codex` 0.162.1) and Grok (`grok`
  1.0.52) provide external review.
- **One draft PR.** All phases commit to the program branch
  `claude/member-agent-program` and its draft PR. Felix reviews there; the PR
  merges once, after Felix's acceptance. Commits are per package and name the
  package id.
- **Dispatch.** On Felix's go signal (given 2026-10-18), Claude starts one
  sub-session per scope with a brief containing: package ids, this document's
  sections it implements, the exact files, the acceptance line, and the
  instruction to request external review before reporting done. Serial
  packages inside one scope run in that session; serial scopes start when
  their predecessor's verdict is PASS.
- **Mechanics.** Each sub-session works in its own git worktree on a branch
  cut from `claude/member-agent-program`, commits per package with the package
  id in the message, pushes its branch and never opens a PR. Claude reviews
  the branch, merges it into `claude/member-agent-program` and pushes, so PR
  #236 accumulates every package. Sub-sessions do not edit this document;
  they report corrections, and Claude applies them. Each sub-session records
  its external review in `design-plans/member-agent-program-reviews/<pkg>.md`.
- **Migrations are serialized.** Parallel packages must not each add a
  Drizzle migration under the same number. Before a package that needs a
  migration is dispatched or resumed, Claude assigns it the next free number
  after the program branch's latest migration; a package that generated a
  colliding number rebases onto the program branch and regenerates its
  migration and snapshot before it is merged. Lesson from Wave 2, where 1c,
  1d and 1e each produced a `0040`.
- **Unattended operation.** Sessions for later phases are opened ahead of
  time with a HOLD brief and started later by a message beginning with START
  that carries their migration number and contract notes, because the app
  only lets the designer open sessions while Felix is present. An hourly
  check in the designer session resumes sessions stopped by a usage limit,
  reviews and merges finished branches, and starts the next held session when
  its predecessors are merged.
- **Final smoke.** After Phase 4 and again after Phase 5, one dedicated Codex
  (GPT-6 Astra Mid) session runs the worked example (§4.5) and the three flows
  (§7) on Felix's real computers and returns screenshots of every intermediate
  state, not only the end state, judged from a user's point of view: anything
  harmful, slow, pessimistic, or visually inconsistent is reported with the
  screenshot. Claude accepts against code plus screenshots; Felix accepts from
  the screenshots as a user.
- **External review.** Each sub-session asks Codex or Grok for an adversarial
  review of its diff with a concrete question ("find a path where a
  non-owner root changes X", "find a state where the derived presence greys a
  present harness"), requiring file:line evidence. Findings are verified
  against the code before they are acted on; unverified findings are noted,
  not applied (standing rule from Felix).
- **Verdict gate.** Each package ends with the repository's `verdict-reviewer`
  agent checking the diff against this document's cited rules, §6 and §9. A
  phase closes when every package is PASS and the phase acceptance holds.
- **Repository gates.** Focused checks and the change checklist in
  `developing/engineering/agent-native-delivery.md` apply to every push.
  Lane safety rules apply to any local Service testing.
- **Dogfood.** Phase 1 and Phase 4 each end with Felix running the worked
  example (§4.5) and the colleague flows (§7) on his own computers before the
  phase is accepted.

## 12. Later, not in this program

Profile-level instructions, persona and memory UI; MemberAgent-level shared
defaults, shared memory and sharing policy; automatic Session archiving;
sharing a Session; letting the requester answer permission questions; a
general safety/privacy watchdog; mobile approvals; owner-chosen public fields;
token and usage statistics; one Profile on several computers; a TTY elevation
cache; Project redesign.

## 13. Open items (verify during the owning package)

- P5: the actual value of `AGENT_PROFILE_WORK_CONCURRENCY_LIMIT` and the
  Service default for `contextConcurrency`.
- C6: whether the Inbox can already answer an `agent_interaction` item
  inline (`clients/web/src/components/inbox/inbox-list.tsx`).
- MemberAgent archive has no write path yet; gate it as a §6 operation when
  it lands.
- Replaying a completed Center Agent `create_configured_agent_profile`
  request re-applies its original working folder without the Phase 5 gate
  (`agent-profile-creation-request-rpc.ts`, `applyConfiguredShimWorkspace`)
  and can undo a later folder choice. Pre-existing; follow-up: apply the
  folder only on first completion, or gate it.
- A composer draft restored after navigation keeps the text of a mention of
  a nonmember Agent but not the choice, so it posts without asking the
  owner (no banner appears). Needs a stored-draft field; follow-up.
- Auth's sensitive-operation audit write has no durable retry (logged on
  failure); follow-up.
- Routines: whether `actorContext.openMeldProfileId` in
  `routine-request-preparation.ts` is the creator, and current behavior when
  the creator leaves (Phase 3).
- Risk-window check: whether RuntimeCoordinator has a per-device read of
  active tasks with their roots (Phase 5).
- Observer widening: read cost of `owner_user_id_snapshot` in the Space DO
  member table (Phase 4).
- Organization directory overview quota exposure: fixed in Phase 4 (`canReadAgentQuota` in `services/core/src/rpc/methods.ts`); quota numbers reach only the owner.
- Personal Remote Agent rejects `autoRelayDepth >= 6`, a pre-existing hard
  block that contradicts the Auto-Relay Loop Policy. Follow-up outside this
  program unless Phase 4 touches hosted collaboration.
- Inbox urgent email is at-least-once (a crash between provider acceptance
  and `markDeliverySent` retries). Per-Session coalescing holds at the row
  level; exactly-once delivery is a follow-up.
- Center Agent permission-mode confirmation is bound to member, target,
  input and a later delivery in Core, but a member who declines in words is
  honored only by the model. A clickable confirmation card would close this;
  follow-up.
- A personal hosted Remote Agent derives its conversation from
  Organization, Profile and Space and ignores `contextSelection: new`, so a
  colleague approved in a Direct Message it already worked in continues that
  conversation. New Direct Message Sessions are new Spaces, so the common
  case is fresh. Follow-up in hosted native delivery.
- External requesters cannot yet read or withdraw their own access requests
  (request routes require Organization membership). Needs a Space-scoped
  requester read; follow-up.
- launchd-started Service and harnesses block in `open` on any path under a
  macOS privacy-protected folder (`~/Desktop`, `~/Documents`, `~/Downloads`),
  including a working folder whose git metadata lives there (a linked
  worktree of a repository under `~/Desktop`). Codex then times out on
  `config/read`; Claude Code hangs silently. Pre-existing on main
  (`codex-app-server-transport.ts`, `TODO(PR #225)`); not caused by this
  program (`member-agent-program-reviews/smoke-harness-investigation.md`).
  Product follow-up: detect the protected-folder case and tell the owner to
  grant access or move the folder, instead of a silent timeout. Smoke runs
  use a standalone clone outside protected folders.
- `service stop --force` and `pnpm dev:stop` refuse a Service process that
  never published a lease ("The Service owner changed"); only
  `service repair --force` recovers (`service-stop-command.ts`,
  `persistUserStopIntent`). Pre-existing CLI lifecycle; follow-up.
- Web setup shows "Reconnecting..." after the CLI already exited with a
  setup failure instead of the failure and next action. Pre-existing Prepare
  presentation; follow-up.
- A user skill folder that is a symlink into `~/Desktop`
  (`~/.agents/skills/*`) blocks Codex session start under a launchd Service
  for the same protected-folder reason; Codex times out on `thread/start`.
  Same follow-up as the protected-folder item above.
- Dispatch results report `effectiveRuntimeWorkingDirectory` to Core
  (`send-dispatch-result.ts`, pre-existing). Confirm it is projected to the
  owner only and decide whether it should become a folder id (Phase 3).
- The Service's local-component manifest was not stamped for the Phase 2
  capability bump (`executionContextVersion` 5 → 6 in
  `config/agents/registry.json`); the release lane handles stamping.

## 14. Decisions to record in `developing/decisions.md`

One entry, 2026-10-18: MemberAgent program adopted; vocabulary MemberAgent /
Harness / Agent Profile / Session; `member_agents` keyed by organization ×
owner × harnessKind with derived state; Remote Agents are `hosted`
MemberAgents; Profiles cannot change harness; default Profile name = harness
name; Sessions are DM Spaces by pairKey or Execution Contexts; folder ids
minted by the Service; every Wake has a human root requester (Routine =
creator; external users consent each time; anonymous rejected); sensitive
operations check the root requester; CLI-credential confirmation only inside
the risk window; quota numbers and tiers stay private; permission-mode
advisor in Phase 1; all work in one draft PR. Detail: this document.

## 15. External review log

- 2026-10-18, Codex (`codex` 0.162.1, read-only) reviewed this document
  against the cited code. Verified and applied: Profile-wide conversation is
  legacy only for harnesses without context support; `exclusive` conflicts
  with every task; member addition has invitation and self-join paths; the
  settings-write evidence pointed at read and disable functions; the folder
  target fence is conditional; ten writers were missing from §6 (Binding
  create/rebind/disable, creation defaults, OpenCode permission, Default
  Project, local envelope, invitations, leave, ownership/access policy,
  work-recovery approval); this document must not override owner documents;
  invariant 1 excluded Center Agents; red line 8 governs Center Agent
  management operations; Phase 2 needed a non-owner stripping basis before
  Phase 3; Phase 5 needed the risk-window contract as a package; rollback
  needed persisted compatibility. Nothing was rejected.
- 2026-10-18, P0 session (owner document rewrites) reported that the repeat
  rejection in §4.6 contradicted the Auto-Relay Loop Policy in
  `agent-transport-contract.md` (loops are prompt-governed, never hard-blocked,
  since 2026-06). Verified and applied: repeat rejection is scoped to
  delegated work; conversational auto-relay keeps the root and appends; the
  depth cap is not stricter than the existing thresholds.
- 2026-10-18, P0 and P1 reports, decided by the designer: computer names are
  owner-only in the MemberAgent projection while the People/Computers
  directory stays as shipped; "no path reaches the cloud" means never stored
  or shown to others, owner-self transit for the folder picker is unchanged;
  invariant 1 excludes all managed Profiles, not only Center Agent;
  `grok-bot` is a harness kind because it is a builtin controller id. P1's
  Codex review (gpt-6-astra, high) found a Session-selected organization
  without membership check on the new read route and a composite foreign key
  bypass via null owner; both fixed in the package. Pre-existing owner-doc
  contradictions with older decisions that P0's review surfaced are out of
  scope and listed in P0's report.
- 2026-10-18, P2 report and its Codex review (gpt-6-astra, high): a selected
  folder failure leaked the absolute path into dispatch failure text (fixed in
  the package); a late folder-list receipt could restore an older list (fixed
  with `foldersRevision`); the pre-existing dispatch-result working-directory
  field means "no path reaches the cloud" is true for folders, not for the
  Service as a whole; §4.4 reworded and §13 extended.
- 2026-10-18, 1c report and its Codex review (gpt-6-astra, high): membership
  re-check moved into the MemberAgent insert; presence debounce now applies
  before any history exists; `not_supported_yet` counts as unknown, not
  uninstalled; accepted reports pair by position; transition read locks the
  row. Designer decisions: a migrated MemberAgent qualifies its organization
  for catalog-update reconciliation (§4.5); the directory overview's
  `includeUsageLimits` exposure is a Phase 4 check (§13).
- 2026-10-19, 1d report and its Codex review (gpt-6-astra, high): welcome
  card named Ask first for every mode (fixed per harness); Session archive and
  personal archive merged into one state with Restore; rename clears the
  personal title; grouped rows combine indicators; Session reads paginate.
  A local-stack check found three Web defects, fixed. 1e report and review:
  stale suggestion cards dropped when the mode changed elsewhere; Apply
  resolves the card before writing; the CLI-credential risk is Phase 5's;
  Center Agent confirmation needs Core-bound evidence, added to Phase 3b.
  Phase 1 is complete on the program branch (migrations 0038–0042).
- 2026-10-19, Phase 3 report and its Codex review (gpt-6-astra, high):
  migrations 0043 (Center Agent permission-mode confirmations) and 0044
  (dispatch ledger chain root). Fixed in the package: represented-member
  requests must match the recorded turn member; `ca-wake:` roots verified
  against the native delivery ledger; connect cannot change an existing
  Binding's permission mode without confirmation; confirmations consumed
  only by a later delivery of the same member; finalized replies keep their
  chain; Remote Agent tools resolve the chain from their own Wake; Session
  question items never reopen on replay; flag-off behavior unchanged. Program
  notes added to §6 and §13.
- 2026-10-19, 4e blockers, verified and decided: the request chain is
  stripped before the Service (`execution-context-authority.ts:936`) and Core
  resolves `auto`, so the non-owner isolated default is a Core hint resolved
  by the Service; no owner-adjustable limits exist yet (Phase 1 did not add
  them), recorded as a follow-up; the visible shared-folder notice is a
  follow-up. §4.9 updated.
- 2026-10-19, Phase 4 (4a–4d) report and its Codex review (gpt-6-astra,
  high): migration 0045 (access grants and requests). Fixed in the package:
  Direct Message conversion cannot add another owner's Agent; an observer's
  live stream never joins or posts; personal Agents without a MemberAgent
  are still consent-gated; owner-participation repair skips Agents joined on
  request; a recorded decision the Space missed is re-applied on read; a
  voided request revokes its allow-once grant; repeated decisions are
  idempotent. A local-stack check fixed held-Wake progress, an outbox flush
  inside the Space gate, a duplicated answer card and Add-members copy. Two
  items moved to §13. 4e (no migration): folder-scoped conflicts, non-owner
  isolated default via `isolated_if_git`, admitted-folder pinning, path-free
  failures. Phase 4 is complete on the program branch.
- 2026-10-19, real-machine smoke rounds 1 and 1b (Codex gpt-6-astra, medium;
  evidence in `dev-tmp/member-agent-smoke/`, not committed): account,
  organization, Space and isolated CLI flows passed; six harnesses detected;
  MemberAgent scenarios A–H blocked first by the smoke's own install rule,
  then by a launchd start stall attributed to the worktree's location under
  `~/Desktop`. Agents empty state lacked Connect computer and loading showed
  "unavailable"; both fixed by 1d (`claude/map-1d-smoke-fixes`, merged).
  Service stop/repair and setup-failure presentation recorded in §13.
- 2026-10-19, real-machine smoke round 1c (Codex gpt-6-astra, medium; worktree
  outside `~/Desktop`): launchd Service start and Computer setup passed; six
  MemberAgents with default Profiles and owner chats were created; Session
  create/rename/archive/restore, first-DM consent with a fresh context,
  revoke, Add-members request, owner observer and Let the Agent join, owner
  versus colleague visibility, and CLI projections passed. Routed: folder
  list UI missing (P1, to p2 `claude/map-p2-folder-ui`); nonmember mention
  not offered, Working shown while waiting for consent, stale request cards
  (P1/P2, to Phase 4 `claude/map-4-smoke-fixes`); default Profile rename
  exposed and first-run folder copy (P2, to 1d `claude/map-1d-smoke-fixes-2`);
  Codex `config/read` timeout and a silent Claude run (P1, cause unproven,
  investigation `claude/map-smoke-harness-investigation`). Invitation page
  approval flash is outside the program.
- 2026-10-19, Phase 5 report and two Codex reviews (gpt-6-astra, high):
  migration 0046. Decision 5a0: no per-device binding is possible, so the
  risk window is owner-wide and read from the RuntimeCoordinator owner shard,
  failing closed. Fixed in the package: cookie-cache replay of a CLI-held
  session, interactive-only endpoints reading through the cache, missing
  gates on Session archive/delete and Profile deletion, runtime-narrowed
  window, audit gaps. §4.7, §6 and §13 updated. P2 folder UI (R1C-02) merged
  with its Codex fixes (Default Project folder removal refused in Core,
  frozen Binding target, revision-guarded lists).
- 2026-10-19, smoke 1c fixes merged: folder-list writes gated as
  `working_folder_write`; @ picker lists other owners' Agents not in the
  Space ("Asks <owner>") and posts bind the request to the message; the
  requester sees "Waiting for <owner>" with Withdraw instead of Working;
  access changes broadcast to both views. A 4b defect found while testing
  (refusals thrown inside `blockConcurrencyWhile` reset the Space Durable
  Object) is fixed. Two follow-ups added to §13.
- 2026-10-19, real-machine smoke round 2 (standalone clone outside protected
  folders): launchd Service started in about 2 s and setup reported all six
  harnesses, confirming the protected-folder diagnosis. Blocked by a P0: the
  Phase 5 confirmation card imports `ShieldWarningIcon`, which the curated
  Web icon facade (`clients/web/src/lib/phosphor-icons.ts`, aliased in
  `vite.config.ts`) does not export, so the Agents page and the Inbox fail to
  load for every user and MemberAgent creation never triggers. Typecheck and
  unit tests cannot see the facade; routed to Phase 5
  (`claude/map-5-icon-fix`) with a guard test over all icon imports. Round 2
  reruns after the fix.
- 2026-10-19, real-machine smoke round 2b (all nine scenarios attempted;
  program head e2d523c5b): Agents and Inbox load; six MemberAgents created;
  Sessions, colleague consent with revoke, @-request into a Space with live
  updates on both sides, owner observer, colleague detail privacy, CLI
  projections, and the Phase 5 CLI confirmation inside the risk window (no
  card outside it) with audit all passed. Not a pass overall. Routed: Agent
  reply showed the owner's absolute path to a colleague (P0, prompt guidance,
  Phase 3 `claude/map-3-path-guidance`); observer owner gets no Inbox card for
  a native permission question and the first released dispatch fails with
  `controller_access_unsupported` (P1, Phase 4 `claude/map-4-smoke-2b`);
  composer folder choice lost before the Service and Continue offers failed
  sources (P1/P2, Phase 2 `claude/map-p2-smoke-2b`); Codex `thread/start`
  timeout in folder tasks (P1, cause unproven, `claude/map-smoke-harness-2b`);
  two MemberAgents created minutes late (P2, 1c `claude/map-1c-smoke-2b`);
  Edit Agent no-op on a default Profile (P2, 1d `claude/map-1d-smoke-2b`).
- 2026-10-19, smoke 2b fixes merged: task prompts for non-owner roots tell
  the Agent its audience is wider and to name the folder by display name,
  never a path; the owner's own composer folder choice survives dispatch
  (human requester Profiles are matched through Organization membership; two
  equivalent fixes arrived, the Phase 2 one was kept); Continue offers only
  forkable tasks; first sync creates every reported harness; Edit Agent opens
  from the Profile detail. Codex `thread/start` timeouts traced to a user
  skill symlink into `~/Desktop` (environment, §13). Phase 4's observer
  Inbox fix is pending.
- 2026-10-19, Phase 4 smoke 2b fixes merged: an observing owner receives
  the native permission question in Inbox (`agentOwnerActivity`, narrowed to
  the Agent that asked) and can answer from Inbox and the observer view
  without becoming a member; a consent release on a harness without Sessions
  runs like a later message. Its review found that such harnesses resume the
  owner's Binding conversation for colleague-rooted Wakes; decided in §4.3:
  non-owner roots always start a new native conversation there.
- 2026-10-19, real-machine smoke round 3 (retest; head a461d5634): passed
  path privacy in a colleague-visible reply, observer owner answering a
  native permission question with the colleague receiving the real output,
  the first released OpenCode request, OpenCode colleague conversation
  isolation (colleague cannot recall the owner's code word; owner still can),
  creation display after a Service restart, and the locked default Profile
  name. Routed: an explicit folder choice is rejected with
  `space.execution_context.unsupported` and a plain Codex DM message fails
  with `execution_context.selection_required` (P1, Phase 2
  `claude/map-p2-smoke-3`); Continue still lists unanswered requests (P2,
  same); native options are not rendered inside Inbox (P2, Phase 4
  `claude/map-4-inbox-answer`).
- 2026-10-19, Felix's UI direction after smoke round 3: the default Profile
  "Edit Agent" dialog is the wrong fix; Profile cards are edited in place.
  Designer audit found parallel UI: a new Folders dialog beside the old
  Working folder dialog, a copied chat history (`member-agent-chat-history`
  vs `center-agent-chat-history`), access-request and permission-suggestion
  cards not built on `ApprovalCard`, and a new Session rename/archive
  dialog. Principles 12–13 added; convergence routed to 1d
  (`claude/map-1d-ui-convergence`).
- 2026-10-19, smoke 3 fixes merged: a folder choice in a Direct Message
  falls back to the Agent's primary Binding when the member snapshot has no
  controller; an ordinary message with no selection continues the most
  recently used Session in its scope (owner-document rule updated; accepted
  by the designer: a plain message must never stop to ask); Continue lists
  only requests with a published reply; Inbox renders the Agent's native
  question inline and files it under Needs action.
- 2026-10-19, UI convergence (1d) merged: default Profile edited inline with
  a read-only harness name; one shared chat history dropdown for Center and
  MemberAgent Sessions; Session rename/archive reuse the chat title editor
  and chat-menu archive; request, credential and suggestion cards share the
  `ApprovalCard` states; one Working folder surface (repair entry pending a
  folder repair operation, follow-up session `claude/charming-nash-0de0f3`);
  the open MemberAgent's Profiles and Sessions in the sidebar with the
  current Session active; two dead ends fixed (Profile back to its
  MemberAgent, Session to its MemberAgent page).
- 2026-10-19, folder repair merged (`claude/map-1d-folder-repair`): a
  `repair` folder operation in schema, Service (capability
  `repairProfileFolders`) and Core; working-folder recovery now opens the one
  Working folder dialog and the old workspace editor is gone. Release order:
  Core before CLI/Service.
- 2026-10-19, real-machine smoke round 4 (converged UI): 7 of 9 passed,
  including folder choice running in the chosen folder, plain Codex DM
  messages, Continue filtering, the native question answered inside Inbox,
  inline default Profile editing, Session sidebar and switching, one Working
  folder surface, and a navigation map with an exit on every path. Routed to
  1d (`claude/map-1d-smoke-4`): identical Session cards in Direct messages,
  an Inbox question that briefly errors before refresh, an answered Codex
  request missing from Continue, a missing local back action on an unknown
  MemberAgent, and inconsistent approval framing. An owner's own reply
  showing the owner's own path is allowed.
- 2026-10-19, smoke 4 fixes merged (`claude/map-1d-smoke-4`): Inbox
  question survives a failed poll and uses the framed approval card; each
  MemberAgent Session card in Direct messages reads "<Agent> · <Session
  title>" (a collapse to one card was reverted after review: it lost unread
  and attention of other Sessions); unknown MemberAgent page has Back to
  Agents; Continue offers answered plain DM requests via their published
  replies. Final real-machine smoke (round 5) follows.
- 2026-10-19, real-machine smoke round 5 (acceptance candidate e2c9b95a9):
  all round-4 retests passed (Inbox question answerable after two minutes,
  answered plain DM under Continue, "<Agent> · <Session title>" cards, Back
  to Agents, framed approval cards) and the core regression passed (six
  MemberAgents, Sessions, first-DM consent and revoke, native question in
  Inbox, sensitive CLI confirmation with audit, colleague privacy on current
  surfaces). Not accepted: after Working folder repair the same chat fails
  with `execution_context.workspace_changed` with only a generic Hand off
  (R5-01, routed to Phase 2 `claude/map-p2-repair-continue`: offer one-click
  Continue in the current folder via the fork path); OpenCode joined through
  Let the Agent join fails with `controller_access_unsupported` (R5-02,
  Phase 4 `claude/map-4-space-join-release`). Noted, not program defects: a
  Claude Code plan-review gate in Chinese comes from the user's own harness
  configuration; an older round-2 message still shows a path in history.
- 2026-10-19, round 5 blockers fixed and merged: every consent release
  (Direct Message allow once and Let the Agent join) reads the harness from
  the Agent's Binding, so harnesses without Sessions run the released
  message; Inbox keeps the user's filter when opening an item; after a
  Working folder repair, the owner's failed request offers "Continue in
  <current folder>", which starts a new Session in the current default
  folder with a short handoff in the same chat (not a native fork, because
  the source folder is gone). A composer pre-send notice is a follow-up.
  Final real-machine smoke (round 6) follows.
- 2026-10-19, real-machine smoke round 6 (fe6d239be): OpenCode now completes
  both consent paths (Let the Agent join and first-DM Allow once) and the
  quick regression passed. Not accepted: the "Continue in <folder>" action
  never renders in the real Message details drawer (it depends on a Profile
  edit context the DM drawer does not provide; unit tests mounted it with
  that context), routed to Phase 2 `claude/map-p2-repair-continue-2`; the
  Inbox Needs action filter still resets on an access-request item, and a
  new native question needed a reload to appear, routed to Phase 4
  `claude/map-4-inbox-filter`. Both fixes must be verified in a browser by
  the implementing session before they report done.
- 2026-10-19, round 6 fixes merged, both verified by their sessions in a
  local browser: "Continue in <folder>" renders in the real Message details
  drawer (no dependency on the Profile edit context) and continues the same
  chat in the repaired folder; the Inbox keeps its filter when any row opens
  and refreshes live for Agent questions and requests. Round 7 retests only
  these two.
- 2026-10-19, real-machine smoke round 7: both round-6 blockers passed
  (Continue in the repaired folder in the same chat, with the next plain
  message in the new folder; Inbox keeps Needs action for access, Space
  consent and native question items, and a new question appears without
  reload, with some delay). The OpenCode owner-DM regression failed with
  `runtime.progress_stale` in the same minute the tester's shell saw
  `~/Desktop` reads stall; that path passed in rounds 5 and 6 and has not
  changed since. Recheck 7b runs with all artifacts outside `~/Desktop`.
- 2026-10-19, recheck 7b (artifacts outside `~/Desktop`): three consecutive
  plain owner messages to OpenCode all replied (`visible_reply`), with no
  `~/Desktop` stall during the run. Round 7's single failure coincided with a
  machine-wide `~/Desktop` stall and is not reproduced; root cause unproven,
  treated as environmental. All real-machine acceptance checks now pass; the
  program is ready for Felix's acceptance.
