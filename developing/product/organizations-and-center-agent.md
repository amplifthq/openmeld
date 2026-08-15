# Organizations and Center Agent — Direction and MVP Baseline

## Agent Context

- Purpose: Carry the settled post-migration product direction — Organization
  tenancy, the Center Agent, and its Web presentation and management homes —
  with the reasoning
  and rejected alternatives, so a fresh coding agent session can align without
  re-deriving or re-litigating any of it.
- Read this when: You are starting work on Organizations, the Center Agent,
  its About or Settings surfaces, invitations, org-scoped routing, org
  permissions, or any schema
  that takes an `organizationId` — or you are a new session onboarding onto the
  post-migration roadmap.
- Update this when: Felix settles a new decision in this scope, reverses one
  recorded here, or the implementation state of an MVP phase changes. Record
  decision reversals in `developing/decisions.md` in the same PR.
- Do not use this for: Wake execution mechanics
  (`developing/architecture/agent-transport-contract.md`), daemon lifecycle
  (`developing/architecture/local-openmeld-service.md`), current Space
  semantics (`developing/product/space-collaboration.md`), Center Agent Task
  product semantics (`developing/product/center-agent-tasks.md`), or
  implementation details that belong in code and scoped owner docs once built.
- Source of truth: This file owns the Organization/Center Agent direction,
  shipped MVP baseline, deferred scope, and red lines until narrower
  product/architecture owner docs fully absorb them. As phases ship, distill the
  shipped parts into those owner docs and shrink this file; remove it when all
  three phases have shipped and owner docs own everything.

## Current implementation baseline

This approved design baseline was settled with Felix on 2026-07-04 (strategy
sessions in the pre-migration ATS repo). Shipped on main: Organization
foundation, hosted Center Agent MVP surfaces, and Remote Agent R1 on the Flue
harness with native delivery, Space reply streaming, Slack channel support, and
Center Agent memory. The approved first-class Center Agent Tasks target is owned
by `developing/product/center-agent-tasks.md`; its presence in this target model
is not a production-release claim. Center Agent Routines are a separate
first-class product surface owned by
`developing/product/center-agent-routines.md`. The former Session Sync
direction is now the Agent Activity product owned by
`developing/product/agent-activity.md`. The Center Agent Web homes and retired
management-panel mapping are approved target state as of 2026-07-13 and land
through W-NAV1..5. Further implementation must follow this baseline; deviations
require Felix, and the change must land here and in `developing/decisions.md` in
the same PR.

## Reading Order For A Fresh Session

1. `AGENTS.md` — repo rules and routing.
2. `developing/product/product-model.md` — current product model (Spaces,
   Human/Agent Profiles, OpenMeld). This document builds on that vocabulary.
3. This document.
4. `developing/decisions.md` — one-line settled-decision index.

## North Star

OpenMeld must not become another Slack clone that merely admits local agents
as members. The test for "Slack clone drift" is what the core object is: in
Slack the core object is the message/channel; everything organizes around
humans talking. In OpenMeld the core object is the **work loop**: a need is
raised, dispatched to a human or an Agent Profile, executed (often as local
agent sessions), produces results, gathers feedback, and iterates.

Reference frame: Andrew Ng's three product-development loops (agentic coding
loop ~minutes, developer feedback loop ~hours, external feedback loop ~days).
OpenMeld's ambition is the **organization-level version of that loop
infrastructure**:

- **Organization** is the boundary the loops run inside.
- **Center Agent** is the loop dispatcher/coordinator brain.
- **Agent Activity** is the privacy-safe coding-work awareness layer.
- Spaces and messages are containers and UI for loops — not the product core.

Anti-goals that guard the other edge:

- Do not build a heavyweight task/workflow system (Jira-clone death). The
  conversation-first Center Agent Task product is intentionally limited to
  durable work, re-entry, coordination, attention, and recovery; it does not add
  custom workflows, backlogs, planning, sprints, estimates, or drag-to-transition
  authority. The lower Agent Task Coordination records still exist only to
  connect exact executions, terminal outcomes, and declared continuations; they
  are not the Center Agent Task registry or a general workflow engine.
- Do not add agent features for their own sake; every pillar must shorten or
  strengthen a real organization's work loop.

The three pillars interlock: Organization is the container, the Center Agent
is the brain, and Agent Activity is the perception. They ship container first,
then brain, then perception (see Implementation Order).

## Pillar 1 — Organization (Tenancy)

### Mechanics: Vercel-style, single container type

There is exactly one resource-container type: the **organization**.

- Sign-up auto-creates a **personal org** (the user is `owner`, sole member).
  Its `name` is the user's name at the data level and its slug is human-friendly
  (derived, reserved-word-checked, editable). The Web workspace switcher may
  label this pinned navigation context **Personal**; that presentation label is
  not the Organization's stored name or a second tenant type. The personal org
  otherwise uses the same code path as any org except the solo guard below.
- Every resource (Space, Agent Profile, Binding authorization, Center Agent
  designation) belongs to exactly one org via `organizationId`.
- A managed Center Agent profile is Organization-exclusive. It may participate
  only in Spaces owned by the same Organization. Authorizing one of its
  Bindings into another Organization never makes the managed profile eligible
  for that Organization's Directory, Space membership, readiness, or Wake.
  Ordinary Agent Profiles keep their explicit cross-Organization Binding
  authorization behavior. An Organization's own designated Center Agent may
  still join that Organization's ordinary Spaces.
- Users can belong to many orgs (membership). Auth stores the account's last
  explicitly selected Organization as a durable entry preference; Web exposes
  selection through the single workspace switcher defined in
  `developing/clients/web.md`. The current Organization in an explicit Web URL
  remains tab-local and does not mutate the Better Auth Session active org.
- The personal org is **permanently solo** (settled 2026-07-05, amending the
  earlier grows-into-a-team direction): it never takes members, and the
  server rejects invitations to it (marked via organization `metadata`
  `personal: true`; fail closed). Collaboration starts by creating a new
  organization; a bring-your-agents wizard re-creates the user's Agent
  Profiles there bound to the same user-owned Bindings (no data
  duplication — duplicating Spaces/Profiles was considered and rejected:
  copies diverge). Spaces do not migrate between orgs (deferred).
  Presentation rules live in
  `developing/product/presentation-progressive-disclosure.md`.

Rejected: GitHub-style dual entities (User and Org both own resources). That
model forces `owner: User | Org` unions through every permission check and
makes personal→org growth a painful resource migration. Rejected in
discussion; do not reintroduce it.

### Naming: `organization` is the tenant — never "team"

The tenant is named **organization** (informally "org") across code, DB, API,
routes, and product copy. This aligns one-to-one with Better Auth's
organization plugin primitives and with GitHub's mental model (org + in-org
teams), so there is zero mapping layer and zero drift surface.

- Do not rename the tenant to "team" or "workspace" in code, schemas, APIs,
  routes, storage, or domain documentation. **Workspace** is allowed only as
  the Web navigation label for the currently selected personal or Organization
  context. The Organization-scoped Settings group displays the Organization's
  stored name. Workspace is not a second resource container or an alias in the
  domain model.
- "Team" is **reserved** for future in-org grouping (see Better Auth `teams`
  sub-feature below). A top-level concept named Team would collide with in-org
  Teams ("Teams inside a Team") — this is why the earlier working name
  "team" was reversed on 2026-07-04.
- "Workspace" remains rejected as the tenant name. Its narrow Web presentation
  use must not leak into Organization identity or ownership contracts.

History note so no one re-litigates: we first considered mapping Better
Auth's tables to `team` via `schema.modelName`. Reversed. Following the
plugin's own naming removes the remap maintenance tax entirely and keeps its
docs directly readable against our schema.

### Better Auth: organization plugin, used as-is

- Use the `organization` plugin primitives directly: `organization`, `member`,
  `invitation` tables; `authClient.organization.*`; `/organization/*` routes.
  No `modelName` remapping. No naming adapter layer.
- The **`teams` sub-feature stays disabled in MVP**. Its namespace is reserved
  for future in-org grouping (members-roster-level grouping; resource
  attachment would still be our own tables referencing `teamId`). Expected to
  matter early for AI-native orgs: headcount stays small while Agent Profiles
  and Spaces multiply, so grouping pressure arrives sooner than in
  human-only SaaS. Enable only when a real org hits that need.
- Auto-personal-org lands via a user-create database hook calling server-side
  org creation; the session-create hook sets `activeOrganizationId`.
- Roles: the plugin's default three — `owner`, `admin`, `member`. No custom
  roles, no dynamic access control in MVP. Org-scoped permission statements
  (via `createAccessControl`) carry our resources (for example
  `space: [create, ...]`, `centerAgent: [designate]`) on those three roles.
- Invitations are the plugin's email-bound invitations (accepting requires a
  session whose email matches the invite). Email verification is on from day
  one; set `requireEmailVerificationOnInvitation` per its documented
  semantics. Generic shareable organization join links (Slack/Linear style)
  are now in MVP under the 2026-07-14 decision in `developing/decisions.md`;
  they are auth-owned and do not change email-bound invitation semantics.
- Auth remains the only writer for join-link creation, reset, and revocation.
  Any verified Organization member may ask the Center Agent to read and share
  the current active link through a private Core RPC without a second
  confirmation. On an explicit share request, the Center Agent may also ensure
  that an active link exists on behalf of that verified member. Auth reads the
  member's current server-side role and permits this represented action only
  for an `owner` or `admin`; a `member` receives a structured permission error.
  Ensure returns the current active link when one exists and creates one only
  when none exists. It never resets or revokes an existing link. Owner and admin
  management surfaces are Web Settings and `openmeld org invite-link`: both may
  read the current link, reset it through `create`, or revoke it, while Auth
  remains the permission authority and writer. Members receive the same
  structured permission refusal on both surfaces. The Center Agent cannot email
  invitations. Personal organizations reject both join-link creation and
  acceptance.
- Mail infrastructure is required for invitations; org-foundation implementation
  uses Cloudflare Email Service via the `AUTH_EMAIL` `send_email` binding.
- The native Better Auth `organizations.logo` column is the only current
  Organization-logo reference. Organization logos are public identity assets,
  not business-resource metadata. A dedicated managed mutation owns validation,
  storage side effects, and compare-and-set updates; generic Better Auth create
  and update routes must reject client-supplied `logo` values. In the initial
  permission model only the `owner` role may upload, replace, or remove the
  logo. Adding `admin` later is an access-control change, not a second writer.
- Personal organizations never have an Organization-logo mutation. Their Web
  presentation continues to use the current account avatar, and the server must
  reject attempts to create logo objects for them.
- Organization metadata that classifies a personal workspace is OpenMeld-owned
  system state. Generic Better Auth Organization create/update requests cannot
  write metadata. A personal workspace slug may still change, but the Auth hook
  must preserve `metadata.personal = true` so the classification cannot be
  removed through an identity edit.

### Identity domain vs business domain

Hard boundary:

- **Better Auth owns identity**: org, member, invitation, session, role.
- Better Auth also owns the Organization's current `logo` reference. Gateway
  owns the referenced image bytes and transformation/storage side effects.
- **Core (D1) owns business resources**: Spaces, Agent Profiles, Bindings,
  Center Agent designations — each carrying an `organizationId` reference.
- Do not put business fields into Better Auth tables via `additionalFields`.
  Business mutations need our own validation, audit, and side effects; hiding
  them in auth hooks was considered and rejected.

### Devices and Bindings under org

- Devices/daemons stay **user-owned**, never org-owned.
- A user authorizes specific Bindings into an org. Only org-authorized
  Bindings are wakeable by org members and the Center Agent. This is the direct
  translation of the existing invariant "bound into a Space → wakeable" to
  org scope. Authorization records stay per-Binding, individually revocable,
  fail closed.
- Binding authorization grants execution eligibility; it does not transfer
  managed identity ownership. Authorization candidate discovery, automatic
  authorization, rebind carry-over, Directory projections, Space member
  mutations, readiness, and Wake must all reject a
  `managedRole = "center_agent"` profile whose `organizationId` differs from
  the target Organization. Do not infer this classification from the display
  name or from the target Organization's derived `isCenterAgent` projection.
- Opt-in includes explicitly approved bulk/automatic policies (settled
  2026-07-05): the personal org auto-authorizes the user's own Bindings;
  org creation prompts once for the creator's agents; a per-user-per-org
  preference can auto-authorize the user's new profiles. First Web entry after
  joining a non-personal Organization prompts once when that preference has
  never been answered, defaulting to authorization for the user's current and
  future bound Agent Profiles. When the same user rebinds a profile, existing
  org authorizations carry over automatically with an audit-journal record. UX
  detail lives in
  `developing/product/presentation-progressive-disclosure.md`.
- A Center Agent request to create and configure an Agent Profile for the
  current Organization is itself explicit authorization intent. The operation
  turns on Wake access for that new primary Binding before Space membership and
  readiness checks. It does not depend on, or silently change, the user's
  future auto-authorization preference.

### URLs: org-scoped from day one

- All app routes carry the org scope: `/o/{orgSlug}/spaces/{spaceId}`, etc.
- `/o/` prefix, not bare top-level slugs: bare slugs (GitHub-style
  `/{orgSlug}`) impose a permanent reserved-word tax (`settings`, `api`,
  `docs`, ...). Rejected.
- `/o/`, not `/org/` (settled 2026-07-04): users consume app URLs by
  clicking and sharing, not by reading the prefix — the org slug carries
  the meaning; the prefix is only a namespace marker (the Reddit `/r/`
  pattern). The short prefix rides on every in-app URL, avoids the
  `/org/`-vs-`/orgs/` singular-plural fork, and leaves room for a
  symmetric single-letter scope family later. Do not widen it for
  "clarity".
- This is a day-one decision because changing URL structure post-launch is a
  breaking change to every shared link.

### MVP org visibility

Joining an org grants, by role:

- `member`: see **Directory → People | Agent Profiles** (Human Profiles and Agent
  Profiles with their existing readiness/presence) and the org Space directory;
  join public Spaces; be invitable to private Spaces; DM the Center Agent.
- `admin`/`owner`: additionally manage members, designate the Center Agent,
  delete org resources.
- Spaces get org-level visibility: `public` (visible/joinable inside the org)
  or `private` (invite-only). Creation defaults to `private`; going public is
  an explicit choice (settled 2026-07-05 at Web implementation review). The
  wire contract still requires visibility explicitly — the default lives in
  the client UI, never in the server. Cross-org guests are out of scope for
  MVP; a Space belongs to exactly one org.
- CLI discovery uses `openmeld space list --organization`. CLI self-service
  membership uses `openmeld space join --self-serve <space-id>` and adds the
  selected Human Profile without opening an interactive session. The ordinary
  `space join <space-id>` command retains its existing meaning: open a session
  for an existing membership. Core, not CLI-local history, decides active
  Organization membership, public visibility, and whether the Human Profile
  may join.

## Pillar 2 — Center Agent

### What the Center Agent is

**Center Agent** is the org's resident coordinator agent. Every org can have
one (MVP: exactly one). Members talk to it; it holds org-level context and
management capability.

"Center Agent" is the **generic product/type name** — it names the kind of
thing, the way "admin" names a role. It is also a system-managed Agent
Profile identity for the org, marked with `managedRole = "center_agent"`.
Users do not create or choose a second Center Agent from the ordinary Agent
Profile list. Ordinary Agent Profiles remain unrestricted; the managed
Center Agent profile is hidden from ordinary Agent Profile lists. Web presents
its read-only identity in the Center Agent About panel and its configuration in
**Center Agent → Center Agent settings**.

New profiles default to "<Organization name> Center Agent" so they remain
recognizable across Organizations. A missing or blank Organization name falls
back to "Center Agent", and an Organization name that already ends with
"Center Agent" is not given a duplicate suffix. Existing profiles are not
renamed by ensure. Future Center Agent settings may let an org customize the
name, role description, avatar, or instructions, but that customization edits
the same managed profile. It must not create a second Center Agent or turn an
arbitrary ordinary Agent Profile into the Center Agent. The UI shows a
badge/label derived from the designation to convey "this is our org's Center
Agent" — identity is read from the managed profile plus designation, never
inferred from a name.

History note so no one re-litigates: on 2026-07-04 the concept name was
revised from a fixed member name "Center" to the generic name "Center
Agent". On 2026-07-07 the designation surface changed again: the Center Agent
is now a fixed system-managed Agent Profile per org instead of an arbitrary
ordinary Agent Profile selected by users. On 2026-07-11 the default display
name was settled as Organization-scoped ("<Organization name> Center Agent",
with the bare-name fallback and no duplicated suffix), overruling a same-day
change to a fixed bare default; the concept/type name stays the generic
"Center Agent". Do not fold the display name back
into the concept name, and do not reintroduce ordinary-profile selection for
Center Agent identity.

### Web product home

The Center Agent has one Web product home with complementary destinations:

- **Center Agent** is the product home for the workspace's managed agent and
  owns a stable secondary sidebar
  with exactly **Chat, Tasks, Routines, Skills, Channels, Apps, Memory, Center
  Agent settings**.
  Chat keeps the existing everyday conversation surface. Tasks owns durable
  parallel work and conversation-first re-entry. Routines, Skills, Channels,
  Apps, and Memory are the single product homes for the scheduled work,
  capabilities, ingress, external access, and retained context they represent.
  The Chat header opens a read-only **About** panel containing the Center
  Agent's name, `@handle`, model, and status. Its Slack shortcut links to
  **Center Agent → Channels**. Owners and admins also see **Manage →**, a link
  to **Center Agent → Center Agent settings**.
- **Center Agent → Center Agent settings** is the only Center Agent management
  page. It contains model information, usage, the Audit Log, and the reversible
  **Pause Center Agent** control in Danger Zone. Only the immutable Organization
  creator may pause or resume it; Web and Core both enforce that exact creator
  identity. Owners/admins may retain their separately authorized configuration
  actions, but role alone never grants operating-state authority.

### Center Agent Tasks

One resident Center Agent may coordinate several independent Tasks at the same
time while Chat remains available. Each Task has isolated versioned context and
one ordered mutation lane; independent Tasks may run in parallel. Task detail is
a conversation surface, not another Center Agent identity or a user-managed chat
session. The Tasks board is a read-only projection, and Agent Task Handles remain
internal exact execution selectors.

The canonical model, access rules, cross-channel continuity, concurrency,
Stop/Retry/Recovery semantics, Inbox projection, and Web presentation are owned
by `developing/product/center-agent-tasks.md`. This file continues to own the
resident Center Agent identity, designation, operating state, Organization
authority, and delegation policy.

The Audit Log records Center Agent tool calls and externally carried Local Agent
requests, authorized Center Agent Context Manifest reads, and verified Context
Load Receipts. It also shows successful Routine mutations and, when a Center
Agent action came from an exact Local Agent delivery, the represented member
and Local Agent client that requested the work. Every current
Organization member may read it. A Local Agent request
records the represented member, the reported client label, and the exact native
delivery correlation, but never its local session id or private transcript. The
write is idempotent per delivery and happens before worker admission, so replay
cannot create duplicate entries or invisible work. The client must show that
readable surface to members, and the server must authorize the same read; the
previous mismatch in which Web hid a read that Core allowed is rejected. Audit
records remain subject to their existing sensitive-data boundaries. The Audit
Log is not Agent Activity and must never be labeled **Activity**.

A Context Manifest Audit Log entry states which represented member requested
the read, which Local Agent client received it, and how many bounded messages
and estimated tokens OpenMeld prepared. A separate Context Load Receipt states
how many exact manifest messages that client reported adding to its working
context. The UI must say **prepared** and **reported loaded** rather than imply
that the model saw, understood, or relied on every item. Neither entry displays
message bodies, a local thread or session locator, hidden model state, or
authorization material. The manifest ledger keeps stable Signal refs and
hashes instead of copying Chat text into D1. This makes the interaction
discoverable without turning the Audit Log into a second transcript.

Downstream provenance reuses the existing native-delivery correlation on the
Audit Log row. Core accepts it only when the active delivery matches the exact
Organization, designated Center Agent, represented Human Profile, and user.
The read projection resolves the Local Agent client from the original request
entry; it does not copy a client label into every artifact or create a second
source ledger. A direct Web, CLI, Slack, or Channel action without that exact
Local Agent request remains unlabelled rather than being guessed.

### Computer setup assistance

The Center Agent may help the represented member connect a new computer,
reconnect an existing computer, or install a required OpenMeld Service update.
Before recommending one of those actions, it reads the Core-owned current
computer projection through `openmeld_list_computers`. The projection returns
the exact `connectedComputerId` used by Connect, a coarse status, current-device
identity, reason codes, and one recommended mode: `setup`, `reconnect`, or
`update_service`. Core binds that read to the turn's verified represented human
member and fails closed before reading inventory when the speaker identity is
missing, mismatched, inactive, or outside the Organization. The read must not
adopt or mutate local-runtime identity. The Center Agent must use that exact
mode and connected computer id when building the trusted action. It must not
infer update state from conversation text, substitute a device id, or expose
another member's computer context.

Presentation follows the conversation host:

- In the first-party Center Agent Direct Message, the trusted computer action
  renders the shared Connect command, Prepare Session timeline, update
  verification, and completion UI inline in both the main timeline and a
  thread. Only the newest trusted computer action in that conversation mounts
  the live flow; older actions remain links and cannot create parallel Prepare
  Sessions. Reopening an action that already started shows an explicit
  **Continue setup** or **Continue update** gate before a new Prepare Session or
  Terminal command can be created. The direct **Connect my computer** starter
  opens the same component without first sending a hidden prompt.
- In Slack, the action is a native button with an authoritative fallback link.
  Lark, Feishu, and generic Message Channels include the exact trusted action
  URL as an ordinary link until their renderers support structured actions.
  External renderers do not attempt to reproduce Web-only interactive state.
- Connect and the Center Agent Direct Message are two hosts of one workflow.
  Setup copy, command behavior, completion truth, and update verification must
  not fork between them.

After an inline setup reaches authoritative completion, Web offers **Continue
with Center Agent**. A required update is not complete until the current
computer projection confirms the required OpenMeld Service version. Clicking
the action publishes a visible preset member message and starts the ordinary
next Center Agent turn in the same main conversation or thread. Once that
member message exists in the timeline, the completion action remains visibly
completed and cannot be submitted again after refresh. Setup completion alone
does not fabricate a member message, reopen a terminal native delivery, or
silently create a new Center Agent execution. A future automatic continuation
would require a separate Core-owned durable continuation contract with explicit
origin and idempotency semantics.

Organization Skills do not contain required Center Agent behavior. The
Organization may have zero Skills. Every current member may view the catalog
and use enabled Skills; owners/admins manage installation and lifecycle, while
an assigned Skill Maintainer may edit only that Skill. Center Agent Skill
mutations re-enter the same Core authorization and release service as Web.
System prompt modules, internal playbooks, tool authority, and runtime
guardrails remain internal and never appear as disabled or locked
Organization Skills.

### Information protection guardrail

Every OpenMeld-managed Center Agent, Message Channel turn, Routine Run, and
compatible local-agent Wake receives the same built-in information-protection
system guidance. It narrowly protects authentication and payment-authentication
secrets, another person's highly private records, and clearly non-public
Organization financial, privileged legal, confidential contract, Board, M&A,
and active security-incident information. The agent checks both replies and
outbound tool arguments, refuses only the unsafe portion, and should continue
with a redacted, aggregated, or process-only alternative when useful.

This guardrail does not change action authority. It must not block ordinary
reads, searches, calculations, or otherwise authorized actions merely because
the topic is finance, legal, HR, banking, or contracts, and it must not add a
confirmation step solely because information is protected. Public, synthetic,
clearly redacted, aggregate, and properly authorized private-context work
remains available.

An Organization owner or admin may add bounded classification hints under
**Settings → General → Information protection**. Members cannot access that
setting or its management API. The text may make classification stricter but
cannot weaken the built-in rules, grant or remove tool permissions, add
confirmations, or act as general agent instructions. OpenMeld never tells the
model to quote the policy. A compatible runtime handling a turn receives the
hints transiently so it can enforce them; an operator of a member-controlled
local runtime may therefore be able to inspect that execution payload or
prompt. Admins must enter only category names or document types, never actual
credentials, secrets, or sensitive record contents. The global built-in
guidance remains active when no Organization policy exists or its read is
temporarily unavailable.

The seven-tab **Manage Center Agent** panel remains retired as a parallel
concept. Its surviving destinations are placed directly in the product sidebar:

| Former tab | Target home                                          | Placement rule                                                                                     |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Overview   | **Center Agent → About**                             | Read-only identity and runtime summary beside the chat home.                                       |
| Channels   | **Center Agent → Channels**                          | The single Channel destination in every workspace; Organizations manage connections, while Personal Workspaces show read-only discovery and an Organization-creation guide. |
| Apps       | **Center Agent → Apps**                              | The single member and shared App catalog in every workspace.                                       |
| Memory     | **Center Agent → Memory**                            | Organization policy and the current member's erase action share one clearly separated memory home. |
| Routines   | **Center Agent → Routines**                          | Routine use and creation remain daily product work inside the product that executes them.          |
| Activity   | **Center Agent → Center Agent settings → Audit Log** | Retire the misleading label; this journal records Center Agent tool calls.                         |
| Settings   | **Center Agent → Center Agent settings**             | One configuration home, with mutations role-gated.                                                 |

The 2026-07-27 cutover removes the former root Routines and Organization
Settings leaf routes directly. Because the product has not launched, do not
retain redirects, compatibility tabs, or a personal-only copy. All maintained
internal callers move atomically to the canonical Center Agent routes. The
complete rail, Settings grouping, and personal parity rules live in
`developing/clients/web.md`.

### MVP scope: the concierge loop only

The MVP Center Agent does one loop end-to-end:

```text
Member DMs the Center Agent with a need
-> the Center Agent converses to shape it
-> the Center Agent builds the collaboration setup: creates the Space, sets
   its collaboration rules, enables or creates the right Agent Profiles,
   invites the right Human Profiles
-> work starts flowing in that Space
```

Success criterion: one conversation with the Center Agent turns a stated need
into a running, correctly-populated Space, measured by our own dogfood org
(first org = ourselves building OpenMeld with OpenMeld).

"The Center Agent can do many things" is not an open-ended license. Org-wide
statistics and autonomous cross-Space work brokering remain deferred. Center
Agent Routines are the bounded recurring-work exception and follow their own
authority, target, scheduling, and native-delivery contract in
`developing/product/center-agent-routines.md`; do not use them to widen the
general concierge tool surface.

### Goal fulfillment and delegated continuation

The Center Agent judges fulfillment at the user-goal level, not only by the
tools available inside its hosted runtime:

1. complete directly when the Center Agent has the required capability;
2. delegate to an authorized Agent Profile when that Agent can complete the
   goal;
3. report a real blocker only when neither path is available or a permission,
   connection, material choice, or required information is missing.

A hosted runtime's inability to access a member's workstation is not a
goal-level failure while an authorized Local Agent can do the work. The Center
Agent Wake tool supports explicit result ownership and completion barriers:

The user states the outcome, not the coordination mechanism. The Center Agent
must independently decide whether delegated work should publish directly or
resume the parent after an authoritative completion condition. It must not
require the user to name Agent Task Coordination, select a completion mode,
remind it to return, or send another message. This responsibility is the same
for OpenMeld Web, Space, Slack, and other Message Channels.

- `child_reports_directly`: the child owns the visible result and the Center
  Agent does not create a duplicate answer;
- `resume_parent_when_all_terminal`: Core creates a new Center Agent turn after
  every declared child reaches an authoritative terminal outcome;
- `resume_parent_when_first_success`: the first successful child creates one
  Center Agent continuation;
- `resume_parent_on_failure`: the first authoritative execution or publication
  failure creates one Center Agent continuation;
- `resume_parent_on_each_terminal`: every child terminal outcome creates its
  own idempotent Center Agent continuation.

Core returns a durable delegation id and exact child Task Handles. A resumed
continuation carries a bounded snapshot of every child state and terminal
outcome, so the Center Agent can synthesize partial success without reopening
the full Space history. Child completion does not depend on the child
remembering to mention or Wake the Center Agent. The continuation uses the
subscription's frozen instruction and exact observer Task Handle. When the
observer is a hosted Center Agent turn, its Native Delivery Ledger row remains
the single source for the requester, conversation kind, destination locator,
and reply placement. Core revalidates current requester membership before model
execution.

Authoritative child failure is completion evidence for the declared barrier,
including workstation `failed_terminal`, Service interruption, and publication
failure. Core records that exact failed Agent Task and activates
`resume_parent_when_all_terminal`, `resume_parent_on_failure`, or
`resume_parent_on_each_terminal` as declared. The resumed Center Agent must
report the real cause, point the member to reconnect or recover a retained late
result when available, and continue coordinating any remaining work. It must not
redo the child's implementation, claim the retained result was published, or
ask the member to manually Wake the parent again.

Center Agent consumes the same surface-neutral Execution Recovery projection
as Web and other clients. Its recovery controls must express
`inspectExecutionRecovery`, `recoverExecutionResult`, and
`resumeControllerConversation` semantics (names may vary only with a shared
schema rename). Center Agent must not guess a recovery prompt, issue a fresh
Wake to replay a durable result, or treat a setup link as recovery. A recovered
result or exact-conversation outcome resumes the relevant parent task
idempotently through Agent Task Coordination; failure, user Stop, and
outcome-unknown remain explicit outcomes rather than invitations to rerun.

The delegated Space message may also include Human or Agent Profiles as
structured Reference context. The Center Agent passes their exact Profile IDs
separately from Wake and fallback targets. Core preserves References in the
Message Envelope and the durable publication command, but never turns them into
children, subscriptions, fallbacks, or continuation conditions. A visible
`@Name(reference)` string is not a substitute for that structured fact.

The initial delegated Wake is also crash-recoverable. Before creating active
child work, Core persists the exact Center Agent Wake publication command under
the same deterministic `clientMessageId` used by the Space. Core prepares the
delegation, posts that idempotent Space message, and activates child
coordination only after the Space confirms acceptance. An interrupted or
outcome-unknown post is redriven by Core without another model turn. A definite
Space rejection first triggers an exact internal read of the same
`clientMessageId`. Core accepts and finalizes any signal already owned by the
Space; otherwise Space atomically records a terminal rejection for that
client-message identity before Core cancels prepared coordination. Every late
idempotent post must honor that rejection. This prevents an earlier
outcome-unknown post from creating child work after its delegation was
cancelled.

The Wake tool distinguishes accepted publication from durable pending
publication. `publicationStatus: pending` means Core owns the retry and the
Center Agent must not call the tool again, report failure, or create another
delegation. It may give one short queued acknowledgement and end the turn; the
declared completion callback still governs any later parent continuation.
Once Space acceptance is durably recorded, a concurrent duplicate call returns
the accepted signal immediately even if another Core attempt is still
finalizing coordination.

One optional fallback Agent may be declared behind exactly one primary Agent.
The fallback is a planned child, not an initial Wake target. Core activates it
only after the primary reaches an authoritative `failed` or
`publication_failed` outcome. Primary success skips the fallback and settles
its subscription without spending an Agent turn. `on_each_terminal` does not
combine with fallback because the meaning of a suppressed primary failure and
per-child continuation would be ambiguous.

This is coordination, not execution authority. RuntimeCoordinator still owns a
workstation Wake; native delivery still owns each hosted Center Agent turn; a
continuation is a new execution and never reopens a terminal parent or child.
The continuation kernel is conversation-surface-neutral. A parent started in a
OpenMeld Space, Center Agent DM, Slack thread, or generic Message Channel may
resume through the same exact-task subscription path. Core derives the resumed
turn and its new Native Delivery from the observer delivery's frozen locator;
the subscription never copies or overrides that destination. This also permits
one Space parent to watch work in another Space without making either Space the
coordination owner.
Stopping the parent cancels pending continuations and planned fallbacks, and
forwards the existing exact Wake Stop request to every active Space Wake child.
Every cancellation target is attempted even when one fails. Hosted
continuations become locally non-publishable before Core retries remote worker
cancellation, so a late result cannot escape the parent Stop fence.

The Center Agent may also explicitly watch one independent exact Task Handle.
This uses the same Core-owned subscription and continuation path as delegation,
but does not create parent-child ownership. The Center Agent declares
`terminal`, `succeeded`, `failed`, or `needs_attention`, ends its current turn
after successful registration, and receives a new continuation only when
authoritative evidence matches that condition. Stopping the observer cancels
its continuation without stopping the independent watched task. Agent Profile
identity, generic availability, Agent Activity, and model polling are never
accepted as task completion.

For a RuntimeCoordinator-owned Space Wake, interaction-needed and terminal
failure observations are durable even when they arrive before the watch or
while the Agent Task Coordination database is unavailable. Core replays the
same exact-task observation and creates at most one parent continuation. A
failed projection is not reported as a successful watch settlement, and a
Queue/alarm retry never asks the Center Agent or member to poll or manually
mention the parent. This does not broaden the separate controller-native
callback capability matrix below.

Space Wake and hosted native-delivery tasks use their existing authoritative
outcomes. When the member refers to a recent Codex or Claude Code task without
providing its exact handle, the Center Agent may list a bounded set of recent
tasks once. Core limits that discovery to the active Organization and verified
requester, optionally filters by one Agent Controller, and returns exact Task
Handles, registration sources, current terminal projections, and the supported
watch conditions. This is discovery for one decision, not a polling surface.
If multiple tasks remain plausible, the Center Agent asks instead of guessing.

Exact registered Codex and Claude Code task handles may be watched only when
their registration source proves the requested condition. The current
capability matrix is deliberately narrow:

- Claude Code `TaskCreated` tasks support `terminal` and `succeeded`.
- Claude Code `SubagentStart`, Codex `SubagentStart`, and Codex
  `UserPromptSubmit` tasks support `terminal` only.
- Claude Code `SessionStart` registrations support no watch condition.
- Current controller-native callbacks do not support `failed` or
  `needs_attention` watches.

Codex Stop and SubagentStop callbacks therefore prove neutral terminal
completion, not success. Unsupported controller refs and conditions fail
closed with a clear callback-unavailable result. Process exit, generic
notification, missing activity, Agent Activity, and availability are never
promoted into controller-task completion.

### First-class citizen rule (hard)

The Center Agent is a **system-managed Agent Profile plus a designation** —
not a special subsystem.

- Its identity, messaging, membership, and authorization semantics are the
  standard Agent Profile semantics — no dedicated DM subsystem, no
  authorization bypass, no alternate message model.
- The managed role is `managedRole = "center_agent"`. There is at most one
  active managed Center Agent profile per organization. This managed role is
  an identity-management marker, not a stored `isCenterAgent` flag.
- Ordinary Agent Profiles are not limited by this rule. Users may create and
  manage ordinary Agent Profiles normally; they just do not select them as the
  Center Agent.
- A Center Agent is not a guest Agent or a portable personal assistant. Future
  cross-Organization agent collaboration requires an explicit product
  contract for origin disclosure, consent, authority, context, memory, tools,
  lifecycle, and audit. It must not be introduced by adding the same managed
  Center Agent profile to another Organization's Space.
- On a workstation-bound (local) runtime it communicates through the
  standard wake pipeline: no dedicated transport, no bypass of
  RuntimeCoordinator semantics. The OpenMeld-operated Remote Agent runtime
  uses the native delivery contract owned by
  `developing/product/remote-agent-runtime.md` (settled 2026-07-06); that
  contract is not a license for side channels elsewhere.
- If the platform cannot host its own Center Agent as an ordinary agent, the
  platform is not good enough for anyone else's serious agent. The Center Agent
  is the dogfood proof.

### Designation model (pointer, not flag)

- New Core table (business domain), shaped for the future but constrained for
  MVP:

```text
center_agent_designations(
  organizationId,     -- FK to org
  agentProfileId,     -- the designated Center Agent profile
  duty,               -- reserved; NULL/unused in MVP
  designatedBy,       -- member who designated
  operatingState,     -- active | paused
  pausedAt,           -- NULL while active
  pausedByUserId,     -- immutable Organization creator while paused
  createdAt
)
UNIQUE (organizationId)   -- MVP: exactly one Center Agent per org
```

- Multi-Center-Agent future (settled direction, not MVP): drop the unique
  constraint, give `duty` real semantics, add a nullable `teamId` when in-org
  Teams exist (org-level chief Center Agent + per-team Center Agents interlock
  naturally). Schema is multi-Center-Agent-shaped **now** so that unlocking is
  a constraint drop, not a migration.
- Do not put an `isCenterAgent` boolean on Agent Profile rows. UI surfaces
  derive `isCenterAgent` from the designation in projections/DTOs. Rationale: a
  pointer makes the one-Center-Agent invariant structural, and switching the
  Center Agent is one atomic pointer change with no two-row flag-flip window.
- The managed Center Agent profile is ensured by the platform when the Center
  Agent is first initialized. Web does not ask users to choose an ordinary Agent
  Profile. Core rejects designation attempts that target a profile without
  `managedRole = "center_agent"`.
- Core may lazily ensure the managed profile and designation when a designation
  read or Center Agent DM open needs them. The product has no disconnect,
  revoke, or member-selectable replacement action for the managed Center Agent.
  Once initialized, its designation and identity remain resident.
- Pausing the Center Agent does not make its managed profile or designation
  removable. Identity-management guards remain in force while paused.

### Operating state

- `active` and `paused` are the only Center Agent operating states. Operating
  state belongs to the designation; it is not profile status, Binding health,
  Channel connection state, or Routine status.
- Only the immutable Organization creator recorded as
  `organizations.createdByUserId` may pause or resume the Center Agent. Current
  `owner` or `admin` role is not equivalent to creator authority. Existing
  Organizations are backfilled from their earliest owner membership; missing
  creator evidence fails closed and exposes no mutation authority.
- Pause is an Organization-wide emergency control. It requests cancellation
  of every current Center Agent native delivery across OpenMeld, Slack, and
  connected Message Channels, including Routine work, and rejects every new
  Center Agent admission while paused. Recovery and replay paths recheck the
  same operating state.
- Pause preserves the managed Agent Profile, designation, Direct Message and
  Space history, memberships, memory, Routines, Channels, Apps, Bindings, and
  settings. Resume returns the same Center Agent identity to `active`; it does
  not recreate or reconnect anything.
- Pause and resume are idempotent and audited as
  `pause_center_agent` / `resume_center_agent`. The pause response reports the
  number of active native deliveries targeted for cancellation. If any
  cancellation cannot be confirmed, Core keeps the Center Agent paused and
  returns an explicit failure instead of claiming that all tasks stopped.

### Identity vs runtime (why local/remote switching is cheap)

- The Center Agent's **identity** is a stable managed Agent Profile: name,
  avatar, DM history, Space memberships all hang on it.
- The Center Agent's **runtime** is whatever Binding that profile currently
  has: a local Agent Controller on someone's machine, or the official remote
  runtime.
- Switching runtime = rebinding the same profile. Identity, history, and
  memberships persist. Members keep talking to the same Center Agent.

### Model selection

Every Organization member may read the Center Agent's effective model and ask
the Center Agent which primary model it is using. Only a current owner or admin
may update the model through the shared Better Auth `centerAgent:update`
permission. This mutation authority is intentionally different from the
immutable Organization creator's exclusive Pause/Resume authority.

The hosted Binding is the single configuration owner. Its nullable `modelId`
has two meanings:

- absent means **OpenMeld default** and resolves the current repo-owned
  `center-agent.defaultModelId` when a new turn is admitted;
- present means the Organization selected that exact available catalog model.

The current OpenMeld default is **Grok 4.6**. The explicit choices are
**Grok 4.6**, **Grok 4.5**, and **DeepSeek V4 Flash**. Changing the system
default is intentionally scheme A: existing Organizations on OpenMeld default
use the new default for their next admitted turn, without a migration or
per-Organization rollout row.

Core resolves and freezes the complete model route exactly once at new-turn
admission. The accepted native-delivery request, its recovery request, and any
exact-task continuation in the same execution chain keep that route even if an
owner/admin changes the Organization preference or OpenMeld changes the
system default. A later independent human or Routine turn resolves the current
preference. This preserves in-progress work without making model selection
another execution authority.

Grok 4.6 and Grok 4.5 accept text and images directly. DeepSeek V4 Flash is
text-only, so the frozen route names Grok 4.6 as an auxiliary
image-understanding model. That model describes an image under an
untrusted-content boundary and DeepSeek receives the description, not the
image. An auxiliary or primary model failure fails the turn; OpenMeld never
switches the primary model automatically.

Reasoning is part of the same frozen route, not a second mutable preference.
The current catalog fixes hosted reasoning to `high`, and the Remote Agent
Harness consumes that value dynamically. Web does not expose a separate
reasoning control in this release.

The Center Agent system prompt receives the friendly effective model name so
it answers a member's question with that exact full name, without shortening or
renaming it from the model's internal knowledge. Web's Model setting and Chat
About panel read the same Core projection and never infer the current model
from profile directory metadata or show raw provider ids. BYOK is not part of
this release.

### Permission model (fail closed)

- Center Agent privileges attach to the **designation**, enforced server-side
  in Core on every call ("is the calling profile the designated Center Agent of
  this org?"). Never client-asserted, never inferred from the hosting user's
  role. A paused designation rejects Center Agent tool execution and new turn
  admission without deleting the privilege-bearing identity.
- The default Center Agent authority is **additive-only**: create Spaces, set
  Space collaboration rules, enable/create Agent Profiles, help verified
  owners/admins ensure and share an active Organization join link, notify
  members, read the organization directory and Space index, and create or edit
  cloud Projects through the represented member's current Project authority.
  Setting Default Project is limited to that member's local Agent Profiles.
  Role-scoped actions use the represented member's current server-side role;
  they are not autonomous Center Agent privileges.
- Center Agent Space creation defaults to private Organization visibility and
  members-only link access. Public exposure requires an explicit verified
  requester instruction and explicit public values for both controls. The
  Center Agent reports the saved access state only from Core's canonical
  creation response, never from requested tool arguments or model intent.
- The Center Agent is not granted autonomous destructive authority over Spaces,
  members, Agent Profiles, connections, or organization configuration. It may
  draft those requests for a human `owner`/`admin` to approve.
- A verified member's explicit request is authority for ordinary safe writes;
  asking the Center Agent to perform an action must not trigger a redundant
  confirmation. In an interactive conversation, delete and merge remain the
  exception and require one separate confirmation naming the exact target and
  effect. A clear affirmative executes without another loop.
- Remove Project is a narrowly approved exception to the no-autonomous-
  destructive rule: it requires a short-lived Core confirmation token issued
  for the exact represented member, Project, and Project version, then consumed
  in a later interactive member turn. Project removal is unsupported during a
  Routine and returns `routine_destructive_action_unsupported` with zero side
  effects.
- Routine management is a narrowly-owned represented-member contract, not an
  autonomous privilege. A verified current member may ask the Center Agent to
  create, list, update, delete, pause, or resume a Routine; Core applies that
  member's exact owner/admin/member creator scope through the same Routine
  service used by human clients. See
  `developing/product/center-agent-routines.md`.
- Every privileged Center Agent action lands in an audit journal from day one:
  actor (the Center Agent), org, action, on-behalf-of attribution.
- Attribution: when the Center Agent acts on someone's ask (for example waking
  another member's agent), the visible action carries the Center Agent's
  display name plus "on behalf of X". This is both UX honesty and the first
  prompt-injection mitigation.

### Runtime

> Ownership note (2026-07-06, revised same day): the remote-runtime
> layering, MVP scope, and delivery contract live in
> `developing/product/remote-agent-runtime.md`. That doc supersedes both
> the "paid tier" framing (the Remote Agent MVP is free with abuse
> guardrails) and the earlier wake-lifecycle adapter approach (the Remote
> Agent is a native agent on a native delivery contract, not a simulated
> workstation). Only the bullets below remain settled here.

- Official OpenMeld-operated Remote Agent runtime, labeled "Remote Agent ·
  Experimental". R1 shipped on 2026-07-09 on the same designation using the
  Flue harness, native delivery, and Slack channel support. This is the current
  product path for connecting a Center Agent.
- Local-agent-backed Center Agent runtime selection is intentionally hidden. It
  did not meet the hosted-runtime feature bar: always-on availability, Slack,
  watchdog behavior, and cross-space context. Do not expose a local Center
  Agent runtime entry point until it is redesigned together with
  bring-your-own-agent support.
- Runtime changes must preserve the same managed Center Agent identity:
  designation, DM history, memberships, and audit meaning remain attached to
  the `managedRole = "center_agent"` Agent Profile.
- Implementation details are owned by
  `developing/product/remote-agent-runtime.md`; this document keeps only the
  Center Agent identity and designation boundary.

### Tool-surface unification (anti-drift)

The hosted Center Agent uses in-process tools over Core APIs. Future local or
bring-your-own Center Agent runtimes must stay thin over the same Core APIs and
must not grow a parallel behavior surface. Two independently-evolved tool
surfaces will drift into two behaviorally-different Center Agents; do not let
them.

The capability tiers, current prompt implementation, and role-semantic
single-source follow-up are owned by
`developing/product/remote-agent-runtime.md`. This Organization owner adds no
second tool or prompt roadmap.

Routine tools follow the same anti-drift rule. Web, CLI, and the six Center
Agent Routine tools converge on the shared Routine service and
`requireRoutineMutationAuthority`; no tool-local permission rule may replace
it. The tool path must carry a verified current human member and preserve
Center Agent actor plus represented-member attribution. Direct Web and CLI
mutations instead record the current human actor with no `onBehalfOf`
attribution. An interactive Center Agent turn uses its verified current human
member. An unattended Routine turn uses the delegated member that Core
reauthorizes at Run admission; it does not invent a new tool-local identity.

Project tools follow the same anti-drift rule. Web, CLI, and the Center Agent
converge on `ProjectService` and `ProjectAuthority`. The tool path carries a
verified current human member, preserves Center Agent actor plus represented-
member attribution, and uses a durable operation record for retry-safe
mutations. It never accepts Organization or role authority from the model.
Current-computer Project discovery and Local Project Connections remain outside
the Center Agent surface because the hosted runtime has no trustworthy current
computer and local paths must not enter model context.

Scheduling is an execution mode for existing Center Agent capabilities, not a
separate agent or authority path. Core reauthorizes the Routine's delegated
member at Run admission. The default catalog-inheritance rule and its explicit
Agent Task continuation exception are owned by
`developing/product/center-agent-routines.md` and
`developing/product/projects.md`; this Organization owner adds no second
catalog policy. Routine management tools remain available under the represented
member's authority, and no catalog decision bypasses capability-owned role,
connection, destructive-confirmation, audit, or fail-closed contracts. Durable
Routine instructions direct ordinary safe actions without a live per-Run
confirmation. They are not destructive grants; Routine delete and merge are
unsupported.

The built-in **Center Agent Self-Evolution** onboarding Routine is the bounded
continuous-learning composition of these existing capabilities. It is
recommended from connected Organization Apps or Slack, can focus on one
Project, maintains explicitly granted approved Organization Documents, and
publishes its complete result to an OpenMeld Space. An owner or admin may also
enable one concise Slack team report. That report is the only optional external
write: it requires the Routine's explicit structured Slack-report grant, while
all other App, GitHub, and Message Channel writes remain blocked by the stored
read-only policy. Its selected-source list is instruction scope, not additional
connection authority. It cannot create or modify other Routines in the current
slice. Full product semantics are owned by
`developing/product/center-agent-routines.md`.

### Channels and Apps

Center Agent integrations have two distinct user-facing families. Do not place
both under a generic `Connections` label:

- **Channels** are places where people or systems can message the Center Agent
  and receive replies. Slack is the first shipped Channel. Lark setup is
  available to every production Organization but remains `configuring` until
  Core verifies both the Event Subscription URL and Message Card Request URL
  for that connection. Feishu stays behind its independent provider gate and
  feature flag. Email, WhatsApp, other
  collaboration platforms, and API delivery may join this family later. A
  Message Channel owns conversation routing, sender
  identity mapping, and the result surface. A Channel may also expose a
  narrowly defined outbound messaging action, such as explicitly publishing a
  top-level message in a Slack channel. That action does not grant model access
  to the provider's wider data or management APIs.
- **Apps** are external systems the Center Agent may read from or act in while
  doing work. GitHub is the first shipped App through OpenConnector. An App owns
  a scoped credential, action policy, and attribution. It is not a conversation
  result surface merely because the same provider also offers messaging.

One Organization may connect Slack, Lark, and Feishu at the same time, with at
most one active connection per provider. These connections all address the
same designated Center Agent Profile and hosted Binding; they do not create
provider-specific Center Agents. Connecting, repairing, moving, or
disconnecting one provider does not mutate another provider's connection.

A Personal Workspace cannot connect a workspace-level Message Channel. Its
Channels destination remains visible and shows the provider catalog in a
discovery state with one primary action: **Create organization**. Slack OAuth
state creation and installation, manual Slack connection, and Lark/Feishu
begin, resume, restart, repair, or poll operations fail closed in Core with
`message_channel.organization_required`. The durable Lark/Feishu scheduler
applies the same Personal Workspace classification before every continuation;
it consumes a historical attempt with `<provider>.organization_required`
without calling the provider. If Organization classification is unavailable,
the scheduler likewise consumes the attempt with
`organization.context_unavailable` so it cannot block later registrations;
the user can start or repair registration after classification is restored.
Disconnect remains the only allowed cleanup operation for a pre-launch
historical Lark/Feishu connection. An informed Slack move may use a Personal
Workspace as the previous source while the destination must be a non-personal
Organization. Creating that Organization does not move Spaces, Apps, Agent
Profiles, memory, or any other Personal Workspace data.

Every accepted Message Channel turn freezes one typed originating-conversation
locator in Core before worker admission. Progress, final replies, and explicit
visible failures return only through that locator. Provider callbacks, model
output, a conversation-id prefix, or a second connected provider cannot
redirect the normal result. Current provider transcripts also remain separate:
using the same Center Agent does not automatically copy Slack, Lark, or Feishu
history into another provider conversation.

When that turn explicitly creates or continues a first-class Center Agent Task,
Core also records the canonical Task event and exact Task context revision under
`developing/product/center-agent-tasks.md`. The frozen provider locator still
owns native publication. Web may render the same authorized Task event without
another model turn or provider write; it does not copy the provider transcript or
retarget the original result.

An active human participant whose internal relationship to the current
Organization is established by its connected Slack, Lark, or Feishu workspace
may talk to the Center Agent even when no OpenMeld member identity is linked.
OpenMeld calls this person a **connected Message Channel member**. The provider
relationship supplies Organization admission, ordinary-member capability, and
provider-level attribution for the current delivery. By itself it never creates
Better Auth membership, a Human Profile, an OpenMeld role, a member-owned
credential, or represented-member authority. Auth remains the sole membership
writer.

The connected Message Channel is a primary OpenMeld product entrance, not an
onboarding teaser. A connected Message Channel member may use every capability
whose canonical owner makes it available to an ordinary Organization member
without personal ownership or an OpenMeld role. This includes trusted
Organization navigation, directory and coarse Service status, approved
Organization documents, enabled Organization Skills, the Space directory,
public Web and bounded public-browser research, and Organization-shared Apps.
GitHub work explicitly selects `githubActor = organization` and executes through
the Organization's GitHub App installation as the OpenMeld bot; it never borrows
the requester's GitHub identity. Ordinary non-GitHub Apps resolve only an active
shared connection for an unlinked member and never fall back to another
member's connection.

App reads run directly. For non-GitHub shared Apps, the action owner's
registered `write` effect grants the same non-destructive operation to ordinary
Message Channel members that verified ordinary members already receive. GitHub
ordinary writes require `githubActor = organization`; file deletion and
pull-request merge remain linked-identity boundaries. Core durably attributes
every request to the frozen provider, connection, provider user, conversation,
source message, and native delivery. Destructive actions, unknown effects, and
actions whose owner requires one OpenMeld human remain linked-identity
boundaries. Information Protection guidance still applies because it
is a disclosure guardrail, not a reason to remove otherwise authorized
Organization capability. Core rechecks the exact active Core-authored native
delivery before every connected-member operation.

Project listing and Agent Activity use explicit ordinary-member read
projections. An unlinked connected member may list Organization Projects but
receives no creator-specific management authority. The Agent Activity tool
returns only the existing public snapshot, which excludes paths, prompts,
transcripts, and private provider metadata. Project mutations and member-owned
Activity or local context remain identity-gated.

Personal memory, member Apps, Local Agents or Computers, role-restricted
actions, destructive confirmation, durable member-owned mutations, and any
action whose owner requires one specific OpenMeld human remain unavailable
until identity is linked. The Center Agent completes every independent safe
part first, names only the concrete blocked action, and attaches the one-time
setup action. It does not stop at an account-status explanation, tell the person
to find an administrator, expose a reusable Organization join link, or ask them
to repeat the request. A verified link never upgrades the already admitted
unlinked turn; Core creates one new deterministic linked-member turn for the
original request after setup succeeds.

For a connected Message Channel member, a blocking **Join {Organization name}
on OpenMeld and continue** action appears only after the same Remote Agent
submission actually reaches one of those identity-gated capabilities. The
dedicated `openmeld_require_identity_for_action` tool records the explicit
requested action's identity-owned, personal, role-restricted, destructive, or
human-attributed boundary only after Core authorizes the exact native delivery.
Safe work never records a blocking boundary. The identity-boundary tool itself
immediately records one generic private **Connect my account and continue**
action when Core advertises provider-neutral handoff support. Directory lookup
and the read-only navigation tool may refine that action only when one existing
member is clearly the same person; they are not required to make the generic
handoff exist. The public reply names only the blocked user action and points to
the private message. Core, rather than the model, owns this fixed public reply.
If the receiver does not yet support the private action, the caller fails with
an observable capability gap instead of claiming that a nonexistent message
was sent. It never mentions tools, catalogs, sessions, routes, or
permission infrastructure. Core issues the one-time link only while publishing
the exact Message Channel delivery. Core confirms the task result first, then
publishes the private setup action. If required setup guidance must be retried,
Core reuses the confirmed result and never publishes that result a second time.
Lark and Feishu deduplicate the private card by provider publication UUID.
Slack retries only a known API rejection; an ambiguous private-message publication
outcome is logged and fenced rather than risking a duplicate action.

After a successful result that did not need linked identity, the Center Agent
does not add an unsolicited account-connection suggestion. A successful shared
task must feel successful. The non-continuing connection action remains
available only when the participant explicitly asks to connect this provider
account.

#### Agent-assisted account connection

Account connection starts only from a live request by the current unlinked
internal Message Channel participant. OpenMeld does not scan Slack, Lark,
Feishu, the Organization directory, Inbox, or email in the background for this
initial flow.

Center Agent may read the current provider account name, provider email when
available, and the Organization directory it is already allowed to read. The
model may reason about name order, transliteration, aliases, and email patterns
to decide whether exactly one current member is clearly the same person. This
is intentionally an agent judgment rather than a second deterministic matching
system. If the evidence is weak or more than one person is plausible, Center
Agent sends no proposed member id.

The comparison grants nothing and normally remains invisible. Center Agent
finishes all independent shared work and does not show a setup suggestion after
a successful ordinary task. It asks Core for a private account-connection
action only when:

1. the current request reaches a personal, member-owned, role-restricted,
   destructive, or otherwise human-attributed capability that genuinely needs
   one OpenMeld user; or
2. the current participant explicitly asks to connect this provider account.

When one member is clear, Center Agent passes that exact directory user id with
the action request. Core rechecks that the id is a current member of the same
Organization and binds the one-time token to that account. When no member is
clear, Center Agent omits the id and Core keeps the normal sign-in or sign-up
handoff. Neither path changes the current turn's sender or authority.

The provider-private message names the concrete blocked action and offers
**Connect my account and continue**. It never says **Review possible account
match**, **Review identity**, or that the user's account is broken. The Web
page shows the exact provider account, signed-in OpenMeld account, and
Organization before **Connect my account and continue** for an existing member
or **Join and continue** for a new member. A Channel reply such as "yes" is not
confirmation. The intended account must authenticate and confirm; a different
signed-in account, conflict, expired action, lost membership, or changed
provider connection fails closed.

Confirmation writes only the canonical exact Message Channel Identity Link. It
does not change a role, merge accounts, copy history, or infer that another
provider identity belongs to the same person. Core creates one new verified-
member continuation turn for the original task. The source turn is never
retroactively upgraded.

For example, `Mina Yu` uses `minayu@acme.example` in Slack while the current
Organization directory contains one member named `Mina Yu` with
`minayu.ai@example.net`. If Mina asks Center Agent to use her personal Computer,
the agent may choose that member and Core privately offers **Connect my account
and continue**. Mina must sign in to that OpenMeld account and confirm before
the Computer action continues. If Mina asks for public research instead, the
research completes and no account message appears.

Slack renders a supported setup action as a private native action. Lark,
Feishu, and other Message Channels render the same trusted Organization- and
request-bound handoff as a native card action when supported, otherwise as one
ordinary trusted link. Provider presentation may differ; admission, authority,
one-time claim, and exact-request continuation do not.

After identity is linked, personal Computer readiness remains a separate
boundary. When the verified requester asks for Codex or another local Agent and
Core reports that their Computer needs setup, reconnect, or an OpenMeld Service
update, the Computer query attaches the exact Core-projected navigation action.
Core publishes that action privately to the same Slack, Lark, or Feishu
identity only after the ordinary task result is confirmed. The public channel
receives the useful result and concrete limitation; the requester receives the
native **Connect this computer**, **Reconnect this computer**, or **Update
OpenMeld Service** action. A normal task that does not query personal Computer
readiness never receives this setup guidance.

The token is frozen to the Organization, Slack workspace, Slack user, and
source native delivery. Core sends the action as a durable direct message
visible only to that exact Slack user; the public thread never contains the
bearer token. A fresh private action supersedes earlier unconsumed actions for
the same Slack identity, so an abandoned setup attempt cannot leave the person
stuck until token expiry. Web preserves the return through sign-in or sign-up
and asks for one confirmation. Core atomically claims the private token for one
signed-in OpenMeld user before Auth may add membership, so a different account
cannot use the same action to enter the Organization. The same signed-in user
may resume that claim if Auth enrollment fails before consumption. An already
enrolled member only
links the exact Slack identity. A signed-in user with a verified email who is
not yet enrolled joins the non-personal Organization as an ordinary `member`
through Auth and links the exact Slack identity in the same setup flow. Core
then atomically rechecks the current workspace Binding and current membership
while consuming the claimed token and writing the link.

After setup, Core uses the source native delivery's durable recovery request to
create a new verified-member turn in the same Slack thread. Its idempotency key
is deterministic from the source delivery and OpenMeld user, so concurrent
clicks and response-loss retries cannot submit the request twice. Web says that
the original request is continuing; it never asks the user to mention the
Center Agent again. During a mixed-version rollout, an action already delivered
by the earlier pre-confirmation sequence may have an `outcome_unknown` source.
The signed-in user's confirmation with that exact consumed, source-bound action
proves only that this recipient received the handoff. Core may create the same
deterministic continuation without settling the source delivery or publishing
the Slack action again. New actions are issued only after the source result is
confirmed. If a known terminal continuation attempt fails after the
identity is linked, Web keeps the linked result and offers one **Try continuing
again** action. Core advances a token-local retry generation only to create a
new deterministic submission key; the native-delivery ledger remains the
execution truth. An exception while recovering the source delivery after
membership and linking succeeds is logged with bounded identity and delivery
context, and is returned as a linked result with a retryable continuation
instead of falsely reporting that setup failed. Older private tokens that
predate source-delivery binding may link the identity but must report honestly
that automatic continuation was not available. Tokens issued into a public
Slack thread before private delivery was required fail closed.

A participant whose provider evidence does not prove membership in the
connected workspace is an external participant, not a connected Message
Channel member. That
person may still talk to the Center Agent using the current provider
conversation and general model knowledge, but receives no Organization tools,
private Organization context, sandbox, connected Apps, or Local Agents. Slack
guests (`is_restricted` or `is_ultra_restricted`) and Slack Connect external
participants (`is_stranger`) are also excluded from Slack self-enrollment.
Current Slack participant status is checked before an explicit identity link or
email match may represent the sender, so an existing OpenMeld membership never
bypasses that provider boundary. They receive one concrete next action: use a
full member account from the connected Slack workspace. The current product has
no access-request or administrator-notification workflow, so the Center Agent
must never claim that it sent one.

Lark and Feishu share one internal Lark-platform implementation, but remain
distinct provider identities because their domains, consoles, tenant
governance, identifier namespaces, and deployment conditions differ. The
Personal Agent Channel grant authorizes only the implemented bot conversation
surface. It never creates a member user grant for Docs, Calendar, Mail, Tasks,
or other business actions. Any future Feishu/Lark App belongs to the separate
Center Agent → Apps and OpenConnector-or-reviewed-first-party action boundary; its
credential, execution, idempotency, and audit path must not enter through the
Channel connection.

During the rapid-validation phase, a supported App exposes every implemented
OpenConnector action that materially belongs to the provider's normal product
surface. OpenMeld does not maintain a smaller hand-curated Routine action set
or omit useful read/write actions only because a powerful use case may carry
more risk. Large provider catalogs may use lazy action discovery so the model
does not receive every schema in one prompt, but every discoverable action
remains available through the same Core-authorized execution path.

This breadth does not create a second authority path. Core still owns the
Organization, represented member, member/shared connection selection,
attribution, confirmation contract, and audit record; the provider still owns
the scopes it granted. OpenMeld never exposes credentials, treats an
OpenConnector connection list as execution authority, invents an action the
provider does not implement, or bypasses a provider denial. Interactive and
Routine turns use the same App action catalog and execution path under the
reauthorized represented member.

During rapid validation, the generic OpenConnector action path does not add a
second OpenMeld confirmation step on top of the provider grant. Core
authorization, represented-member attribution, and the attempted plus terminal
audit outcome remain mandatory. A verified user's explicit request or a
Routine's explicit durable instruction authorizes ordinary App writes. In an
interactive turn, delete and merge still require the unified separate
confirmation; a Routine may execute them only when its durable instructions
name that exact destructive action and target. OpenMeld does not invent a
Routine-only restriction for generic App actions.

OpenMeld uses one GitHub App registration for both GitHub connection forms:

- **Organization access** is one GitHub App installation. An Organization
  owner or admin installs the App, chooses all repositories or an explicit
  repository subset in GitHub, and completes OpenMeld's installation
  verification. OpenConnector mints short-lived installation access tokens for
  execution. Organization work is authored by the OpenMeld bot, not by the
  human who installed the App.
- **Your GitHub** authorizes the current member through the same GitHub App's
  user authorization flow. It represents that GitHub identity and may be used
  only for an interactive task that explicitly requires the requester or a
  personal repository. It is not a fallback for Organization work.

Every dedicated GitHub tool requires the model to choose
`githubActor = organization | requester` from the concrete task. Core enforces
that exact choice and never silently falls back between the two credential
forms. Routines and other unattended execution require
`githubActor = organization`; member research also cannot borrow a member's
GitHub identity. Missing installation access, missing personal access, or a
repository outside the installation grant fails visibly with the matching
remedy.

The installation start is bound to one Organization, installer, Center Agent
profile, and target connection by a single-use ten-minute opaque state. GitHub
returns the installation id to OpenMeld's public setup callback. OpenMeld then
uses a temporary verifier connection to prove that the same signed-in GitHub
user can see that installation before OpenConnector stores the final
installation credential. Core stores the installation id and connection
ownership metadata, never an installation token, App private key, OAuth client
secret, or user token.

A normal OpenMeld disconnect removes only the current Organization's registered
connection and matching OpenConnector credential. It does not sign the browser
out of GitHub or uninstall the OpenMeld GitHub App; installation repository
access remains managed in GitHub Settings → Applications → Installed GitHub
Apps.

OpenMeld account sign-in remains a separate authentication integration. It
neither creates GitHub repository access nor conflicts with this App
connection. Because the product is still pre-release, the OAuth App connector
rows are not migrated: operators disconnect the old GitHub connector
connections, users reconnect through the GitHub App, and the old connector
OAuth App is revoked after the cutover is verified.

Every new Notion connection uses OpenMeld's public OAuth Connection by default.
The authorizing person chooses the Notion workspace and pages OpenMeld may
access; the grant cannot reach content outside that selection or beyond the
authorizing account's existing permissions. A member connection represents that
member's authorization, but provider actions authenticate as the Notion
integration bot rather than impersonating the member. OpenMeld keeps the
authorizing member visible for ownership and audit without presenting bot
activity as human-authored Notion activity. An owner/admin-managed shared
connection makes the selected access available to Organization work and
Routines through the existing Core connection projection while preserving the
same distinction between the OpenMeld authorizer and the Notion bot execution
identity.

`Use an internal connection token instead` remains an explicit advanced
fallback for a Notion Workspace Owner who manages a private internal
connection. The Owner enables only the capabilities OpenMeld should use and
grants Content access to the pages and databases the connection may reach; a
new internal connection has no content access by default. Existing token-backed
connections remain valid. OAuth and internal-token authorization both converge
on the same Core-owned App connection identity and status truth.

Figma uses OpenMeld's reviewed public OAuth App. Any member may authorize the
Figma account they choose, including an account that belongs to a different
Figma Organization or team from every other OpenMeld member. The OAuth grant is
delegated user access, not a binding between one OpenMeld Organization and one
Figma Organization. `Your access` remains executable only for that member.
`Organization access` is an owner/admin-controlled shared connection that keeps
the authorizing Figma identity visible; it does not become a Figma service
account or silently gain Organization-wide Figma privileges.

The public OAuth App requests only the reviewed granular scopes implemented by
the shipped Figma actions, uses PKCE, and keeps long-lived access refreshable in
OpenConnector. Those scopes never expand the authorizing account's existing
Figma permissions, so only files, libraries, comments, and Dev Resources already
available to that account are reachable. Figma does not make its Projects
endpoints available to public OAuth Apps. The public scope set therefore
excludes `projects:read` and `project_metadata:read`, and OpenConnector makes
project actions ineligible for OAuth connections instead of presenting a
provider denial as a reconnectable error. Existing PAT-backed registrations may
retain project actions until they are disconnected, subject to the authorizing
account's Figma permissions. Web offers OAuth for every new or replacement
Figma connection and never asks a member to paste a Figma token.

A provider may appear in both families as two independent integrations. For
example, Slack as a Channel routes conversations between people and the
Center Agent. A future Slack App connection could separately let the Center
Agent search Slack history or perform Slack actions through OpenConnector.
Connecting, moving, or disconnecting either integration must not authorize,
move, or disconnect the other. `Connector` remains an implementation and
vendor term; the product category is `Apps`.

Do not show a planned Slack App merely because the Slack Channel exists. The
Channel is presented as Slack in **Center Agent → Channels**. A separate Slack
entry appears in **Center Agent → Apps** only when OpenMeld ships a distinct
OpenConnector-backed Slack data/action connection and its model-visible tool
surface.

The Slack Channel installation requests a reserved scope bundle, but OAuth
possession is not OpenMeld execution authority. Only implemented, model-visible
tools with Core authorization may use those scopes. The shipped read-only
workspace-directory action uses `users:read` and `users:read.email` to fetch one
bounded live page of active human Slack members. Core first resolves an exact
Organization- and workspace-scoped Slack identity link to a current OpenMeld
Organization member, then falls back to an exact normalized email match. A
valid identity link or email match proves current membership. Without either
match, a different available email means not a current member and a missing
email remains unknown. Names, titles, and other Slack profile fields are
untrusted evidence and never establish identity. The action is audited after a
successful read and does not persist a Slack roster, invite anyone, or contact
anyone. When a verified member explicitly asks to notify a directory result on
Slack, the model may use that result's exact Slack user ID for a real
`<@USER_ID>` mention. For explicit channel publication, the posting tool accepts
those IDs through a structured field, verifies that the same turn's directory
read returned them, and constructs the mention tokens outside model-authored
text. It rejects display-name mentions and guessed IDs.

A successful first Slack connection and an informed move from another
Organization both start one trust-first onboarding sequence for the current
Slack installer. The OAuth completion atomically links the exact authenticated
Slack installer identity to the signed-in OpenMeld user alongside the workspace
Binding and encrypted token, so the welcome's native actions work immediately.
Core first asks the designated Center Agent to learn about the installer through
the existing bounded member-research contract. Remote Agent writes Core's exact
rendered Profile Report draft to
`/computer/home/documents/Profile Reports/{person name}/{Core-assigned report title}.md`
on the Center Agent's private Computer and records that file as completion
evidence. The Computer file body and the current visible Organization Document
body come from the same Core draft write result; neither surface independently
reconstructs or substitutes the report. Core assigns
`{YYYY-MM-DD} — Work Profile` to the first report of the
day and appends ` (2)`, ` (3)`, and so on for later same-day reports. The
Organization Document title is the only file-naming truth; Remote Agent never
invents a second collision suffix. The human-readable person folder and dated,
typed file name leave a stable place for future Profile Reports created on
different dates or from different learning plans. Only
after the research task, provisional Organization Document draft, and exact
Computer file all exist does Core send the first Slack direct message. The
message explains OpenMeld in plain language as a place where people and agents
work as one team, names the Organization, shows at most one evidence-backed
observation, and invites an ordinary reply. It never makes GitHub, coding
agents, approval work, or a feature checklist the product's opening idea. When
evidence is insufficient, it says so instead of inventing familiarity.

The welcome offers **See what I learned**, **Invite teammates**, and
**Introduce me in channels**. It offers **Connect more context** only when the
Organization has no active App connection. The Slack teammate action opens a
native multi-user picker, accepts at most ten selected active human workspace
members, and sends a private invitation to each through an idempotent delivery
ledger. Every welcome button and modal submission rechecks the linked person's
current Auth-owned Organization membership before it exposes a join link or
performs an action; a removed member cannot keep using an old Slack identity
link. A current member may share an existing active Organization join link;
only an owner or admin may create that link when none exists. If a member asks
to invite teammates before an owner or admin has created a link, the modal
submission closes and the Center Agent immediately sends that member one
private next step instead of failing silently in background work. It never
posts those private invitations to a channel. A channel
introduction starts in direct message: a native picker accepts at most five
public channels, Core joins those channels when needed, and the Center Agent
reads one bounded recent page before posting a short introduction grounded in
the channel's actual work. Core includes an existing active Organization join
link for any verified member; an owner or admin may also create the missing
link. A member without link-creation authority can still complete the
introduction without a link. The Center Agent does not rank people, disclose
private observations, or mention an individual unless the requester explicitly
asked it to notify that person.

An invited Slack user receives the Organization join link and a simple account
of what will happen after joining; OpenMeld does not claim to know that person
before Organization membership exists. After an exact normalized Slack email
matches a joined Organization member with an active Human Profile, Core links
that same Slack identity, atomically claims at most one onboarding across all
delivered invitations for that Organization, workspace, and Slack user, runs
member research for the new member, writes the Profile Report to the Center
Agent Computer, and sends a second private welcome with one evidence-backed
observation or an honest insufficient-context state. Duplicate invitations are
closed without starting another research task or sending another welcome.
The second welcome has its own durable publication claim. A confirmed Slack
rejection may retry, a confirmed delivery is recovered by its recorded message
id, and a lost or ambiguous outcome never triggers a blind second message.
The new member may then reply in Slack, invite more teammates, or start the
channel-introduction flow. A move starts a new Organization context with
different members, Spaces, Apps, and agent state, so reusing the previous
welcome state would be misleading. A same-Organization reauthorization does
not repeat the sequence.

Lark and Feishu support the same product shape through Lark Card 2.0's
`multi_select_person` component and `card.action.trigger` form values; they do
not require Slack's modal API. Provider parity must reuse the same trust-first
research, membership, invitation, and publication ledgers rather than adding a
second onboarding authority. Until that adapter is implemented and real-smoked,
the Slack native picker remains the only shipped native teammate selector.

The shipped outbound action requires an explicit request from a verified
current human member to publish a top-level channel message, is recorded in the
Center Agent audit journal before the external write, and never changes the
originating thread's role as the turn result surface.
Reactions, search, link unfurling, commands and shortcuts,
Canvases, pins, bookmarks, channel management, and user-group reads remain
unavailable to the Center Agent until their own event or tool contracts,
authorization rules, attribution, and tests ship. A future Slack App connection
must still establish its own ownership and execution authority rather than
silently treating the Channel installation as an App connection.

App credentials have two ownership forms:

- A **member app connection** belongs to one OpenMeld member's external
  identity and is registered inside one Organization. The Center Agent may use
  it only while acting for that verified member in that Organization. It is
  private to its owner for execution even though Organization owners and admins
  may see and revoke the registration. Product surfaces must show whose account
  will be used, and actions must preserve that attribution.
- A **shared app connection** is controlled by the Organization rather than by
  one member. Only an Organization owner or admin may connect or revoke it, and
  every change is recorded in the Center Agent audit journal. The authorizing
  member's external identity remains visible when provider actions execute as
  that identity. GitHub is the explicit exception: its shared connection is a
  GitHub App installation, so provider actions execute as the OpenMeld bot while
  the installing member remains setup and audit attribution. No member
  connection may be relabeled or treated as shared by convenience.

`Your access` identifies the current member's connections, with `Your GitHub`
as GitHub's concrete title. `Organization access` identifies
Organization-controlled shared connections. Both appear inside the same
**Center Agent → Apps** page and neither label changes the underlying ownership or
execution authority.

Management location follows the owner instead of repeating mutation controls:

- In every workspace, **Center Agent → Channels** is the single Channel
  destination. It owns Channel management in an Organization and shows only
  Organization-creation guidance in a Personal Workspace. **Center Agent →
  Apps** is the single catalog and
  management surface for both the current member's connections and
  Organization-shared connections.
- The first-entry Organization dialog may offer one-time, role-appropriate
  Slack Channel and GitHub App connection actions after the member confirms
  Wake access. It keeps Channels and Apps visibly separate, has no disconnect
  or repair controls, and accepts success only from the owning Core projection.
  Center Agent remains the ongoing management home.
- The Center Agent Chat page has no Channels or Apps mutation copy. It may show
  a read-only status shortcut and compact handoff dialog when context makes the
  canonical Center Agent destination useful, but the dialog must only
  deep-link; it must not install, move, disconnect, or otherwise manage the
  integration.
- When the Center Agent tells a user to complete or repair App access, it uses a
  structured Navigation Action for the current Organization's canonical App
  page. The reply gives the outcome, one concrete next step, and that direct
  link; it does not ask the user to find the Organization selector or reconstruct
  the Center Agent path themselves.
- All Organization members may view Channel and shared App status. Only owners
  and admins may mutate Organization-owned access; members may manage their own
  member app connections.
- The personal workspace uses the same Center Agent pages. Only content, available
  actions, and role-appropriate guidance differ.

These locations are presentation and mutation-entry boundaries. They do not
create new credential owners, OAuth grants, selection rules, or Core authority.

#### Member app connections (shipped)

Every Organization member may connect their own supported external account.
Core is the ownership authority: each registered connection records the raw
Organization id, member user id, service, executor connection name, lifecycle
status, and timestamps. OpenConnector stores credentials and executes actions;
its connection list never grants OpenMeld authority. The legacy global
`github:default` connection is intentionally unregistered and cannot be used by
any Organization.

The designated Center Agent may use an active member connection only when the
verified current requester owns that connection and remains a member of the
current Organization. It must not fall back to another member's connection.
Slack turns may use a member connection only after Slack identity resolves to
that same verified member. For ordinary non-GitHub Apps, an unattended Routine
may use a member connection only when its currently reauthorized delegated
member owns it; it never borrows another member's connection. The same
requester-first selection may then use Organization access as the fallback.
Cross-org, removed-member, and cross-member selection fail closed.

GitHub does not use this automatic order. An interactive GitHub tool call must
explicitly select `requester` before Core may use the current member's GitHub
identity. Routines and member research reject requester selection and use only
the Organization's GitHub App installation. Read replies name the chosen
identity. Ordinary GitHub writes execute directly when the verified user or
durable Routine instruction requests them. Interactive file deletion and
pull-request merge require one separate confirmation naming the concrete
action, repository, and chosen identity. Routine file deletion and
pull-request merge return `routine_destructive_action_unsupported` with zero
side effects. A member connection may be disconnected only by its member owner
or an Organization owner or admin.

#### Shared app connections (shipped)

Each Organization may have at most one shared connection per supported App.
The connection records `scope = shared` plus the owner/admin who authorized the
provider setup. Linked OpenMeld members and connected Message Channel members
may ask the Center Agent to use it, and unattended Routines may use it because
no member-owned credential is borrowed. For a linked interactive member,
ordinary non-GitHub Apps retain requester-first, shared-second selection. For
an unlinked connected Message Channel member, selection is shared-only. Missing
delegated-member identity still fails the Routine boundary.

GitHub Organization access instead records the verified GitHub App installation
and always executes as the OpenMeld bot. Interactive work uses it only when the
tool explicitly selects `organization`; every Routine GitHub action must select
it. A connected Message Channel member may select only `organization`. There is
no automatic fallback to or from `Your GitHub`.

Shared access never hides the real execution identity. Read results identify
the connection as the Organization's shared App and name who connected it.
Writes disclose the repository, provider identity, and shared scope before the
action. A connected Message Channel member may write only when the owning action
policy explicitly grants ordinary members and does not require linked identity,
a verified role, or destructive confirmation. Only an Organization owner or
admin may start, replace, or disconnect a shared connection, and those mutations
are auditable.

### DM shape

"DM the Center Agent" uses the shared Direct Message Space model owned by
`developing/product/space-collaboration.md`. It is a lazily-created private
Space with DM origin, a pair key for the member profile and the Center Agent
profile, and current DM state derived from active membership.

There is **no separate DM subsystem** and no Center-Agent-only DM transport.
The Center Agent's old lazy-DM entry point is a compatibility entry point into
the same open-or-create Direct Message implementation:

- If the legacy Center Agent DM Space exists and is not degraded, opening the
  DM reuses it and backfills the immutable DM origin, pair key, and guide.
- If the legacy Space has degraded into an ordinary Space with more than two
  active members, opening a new DM creates the next generation for the same
  pair instead of reopening the old group conversation.
- Center Agent DM messages trigger exactly by the shared DM rule: current DM
  state, exactly one active human and one active agent, and the human authored
  the text message. Agent-authored messages never auto-trigger.

The Center Agent DM specialization, including its two-member constraint,
rejected mutation surface, and ordinary-list exclusion, is owned by
`developing/product/space-collaboration.md`. This document adds no second DM
model.

Local Agent harnesses follow the same rule. An authenticated member's Codex,
Claude Code, or another local harness may submit through
`openmeld center-agent ask`, but the CLI only carries the request into that
member's existing Center Agent Direct Message. The resulting member message is
visible in Web Chat with a bounded `via <client>` attribution. The local client
and optional local session id are trace facts, not speaker identity, access
authority, a second conversation, or permission to import the local harness's
private transcript. Center Agent replies return through the same durable DM
result path, so a member can move between Web and a Local Agent without meeting
a different Center Agent or losing the visible conversation record.

For Local Agent bridge commands, the account's current server-selected
Organization is the default only at top-level command admission. OpenMeld then
freezes that Organization for the entire request so a concurrent switch cannot
split one interaction across Organizations. A member may instead pass
`--organization <slug-or-id>` to pin work explicitly; OpenMeld verifies current
membership without changing the account's default Organization. The Auth-owned
account `lastSelectedOrganizationId` is the canonical default; Better Auth
Session active Organization remains only a backward-compatible recovery when
that account preference is absent. A subsequent unqualified command follows
the newest server-selected Organization. Context Manifest continuations and
load receipts carry their originating Organization explicitly rather than being
reinterpreted under whichever Organization becomes the account default later.

### Memory policy

Center Agent memory has two product scopes, both owned by Core policy rather
than by the model provider:

- **Member memory** is scoped to one member inside one organization. Completed
  Center Agent DM turns may build that member memory, and the member can wipe it
  without deleting messages, Spaces, or shared organization memory.
- **Organization memory** is on by default. Completed Center Agent turns in
  shared Spaces and connected Channels can be used as Organization memory until
  an organization owner or admin turns it off. Private Center Agent DMs never
  write to Organization memory automatically. The Center Agent may save an
  explicit Organization fact only while Organization memory is enabled.
- Recalled memory keeps the source surface and occurrence time of the episode
  that produced it. Entering through a different DM, Space, Slack, Lark, or
  Feishu conversation must not relabel the memory as if it came from the
  current conversation.
- A verified member keeps member-memory continuity across Center Agent DM,
  Space, Slack, Lark, Feishu, Task continuation, and a future Local Agent
  carrier. The current environment changes disclosure behavior, not who the
  requester is. Shared replies may use private recall to stay helpful but must
  not expose the private fact or its source. A connected unlinked member may
  recall Organization memory only while it is enabled; an external participant
  receives no Center Agent memory.
- The same verified member and designated Center Agent identities remain stable
  when the carrier changes. Current `interactionEnvironment`, authorized
  source-attributed context, and recalled memory may influence the answer, but
  exact provider and Space transcripts remain in their owning conversations.
  Runtime generation rollover is invisible and does not create another member,
  Agent, Task, Space, or memory scope.
- An explicit save records `explicit_save` as the capture method while keeping
  the verified conversation surface as its source. The save mechanism must not
  replace a DM, Space, Slack, Lark, or Feishu origin with `explicit_tool`.

Core owns scope, authorization, enabled state, subject identity, and deletion
lifecycle. `developing/architecture/data-and-observability.md` owns storage and
provider boundaries; `developing/product/remote-agent-runtime.md` owns recall
and turn-envelope behavior. **Center Agent → Memory** owns both the current
member-memory wipe entry and ongoing Organization policy management as clearly
separated sections. **Settings → Personal → Privacy** links there instead of
owning a second mutation surface. Setup Studio presents the Core-owned default
as enabled without manufacturing a user choice. It does not own another policy
or ongoing management surface.

### Organization Documents

Documents are organization-scoped Markdown context. Every document body
persists as plain CommonMark + GFM text so humans, the Center Agent, and
local agents all read the same clean Markdown; the Web editor must not
introduce storage syntax outside that contract. It has three document kinds:

- one canonical **Organization Brief** per organization, used to tell the
  Center Agent who the organization is, how it works, and how work is assigned;
- dated **Profile Reports** associated with an organization member's user
  identity; each automatic learning run creates a new report instead of
  replacing that person's report history; and
- up to 50 ordinary **knowledge** documents.

Documents may be organized into nested, organization-scoped **folders** (up to
50 total). A folder name is unique among its siblings, including the Documents
root, so the same name may be reused in different branches. Folders are a
placement surface only: they carry no permissions, no upload surface, and no
meaning to the Center Agent context assembly. Deleting a folder unwraps one
level: its documents and direct child folders move to the deleted folder's
parent, and it never deletes document content. Folder create, rename, delete,
moving folders, and moving documents require owner/admin authority, and every
current member sees the same hierarchy. OpenMeld owns one managed **Profile
Reports** root and one managed child folder per researched person. Reports are
normally stored at `Profile Reports / {person name} / {YYYY-MM-DD} — {report
type}`. If an ordinary root folder already uses `Profile Reports`, OpenMeld
preserves that folder and everything inside it, then creates a collision-safe
managed root such as `OpenMeld Profile Reports`; it never adopts or locks a
user-managed folder. If
more than one report of the same type is created for a person on the same day,
Core preserves every run and adds a human-readable ordinal suffix such as
` (2)`. Reports carry the report date and type as structured metadata. Managed
report folders
cannot be renamed, moved, deleted, used for unrelated documents, or extended
with manual child folders. Web also omits every managed report folder from
manual document and folder move destinations; Core rejects the same targets so
drag-and-drop, menus, and direct requests preserve one rule. The Center Agent may create other root or nested
folders, rename those folders, and move ordinary documents when acting for a
verified owner/admin. Deleting and moving other existing folders remain
human-only management actions.

Every current organization member may read documents. Owners and admins may
create, rename, edit, delete, approve, and discard across the organization. A
member may edit only the Markdown body of an existing Profile Report about
them; that exception does not grant creation, title, deletion, approval, folder
management, report placement, or other-member access.

Every human content save carries the Document `updatedAt` and nullable draft
version that the editor loaded. Core applies the content only when both still
match. If the Center Agent writes a newer Profile Report draft or another human
changes the Document first, the older editor keeps its unsaved text and receives
one explicit conflict outcome instead of overwriting the newer work. Title-only
and folder-only management updates do not use this content-version fence.

The Center Agent normally creates or replaces the single pending draft for a
document. Ordinary Organization Brief and knowledge drafts use an explicit
human review flow. A Profile Report starts as a provisional working report, but
Web presents the latest report as **What I've learned so far** in the normal
editable Document surface without assigning approval, correction, or discard
work. Saving any human edit turns that version into the current Document content
and clears its internal provisional fields; the person can also simply tell the
Center Agent when something feels off. Welcome preparation reads the current
visible report body, whether it is still provisional or was already saved, so a
fast human save cannot stall onboarding. When several reports share a date,
Directory treats the later-created learning run as latest; editing an older
report never makes it replace a newer run. When a verified owner/admin explicitly asks
for a direct save in the current accepted turn, or explicitly grants a Routine
the structured `organization_documents.save_approved_knowledge` action, the
Center Agent may create or update approved ordinary knowledge content without a
second approval step. Routine instruction text alone is not this authority.
Core binds the save to the current accepted native delivery and, for a Routine,
to its current Run and stored action grant. Direct saves never apply to the
Organization Brief or Profile Reports, and they fail while the target document
has a pending draft so an unreviewed proposal cannot be erased or silently
approved. Human edits to ordinary documents continue to write approved content
without clearing a pending review draft. Approval and discard carry the draft
version the human reviewed; if the Center Agent replaces that draft first, Core
rejects the stale review so the human must read the latest proposal.

When the Center Agent performs substantial file-based editing, it checks out a
writable Computer working copy from the approved Documents projection. The
working copy records the formal Document `updatedAt` it started from. Submitting
that file creates or replaces the normal reviewable draft only when the formal
Document still has that exact version; any intervening human edit, approval,
discard, or Agent draft fails with an explicit working-copy conflict. The
working copy never writes approved content directly and never becomes a second
Document identity. Remote Agent rematerializes the exact Core-owned approved
snapshot at the start of every turn whose frozen context plan allows
Organization Documents so Agent-written projection drift cannot survive as
current content. Before a turn whose plan disallows Organization Documents can
use Computer tools, Remote Agent clears any projection left by an earlier turn.
Working-copy identity and base-version checks come
from that trusted in-memory snapshot, never from a manifest or sidecar inside
the Agent-writable Computer filesystem.

Only the approved, non-empty Organization Brief is placed into the Center Agent
system prompt. The full body is explicitly organization-maintained data and
cannot override OpenMeld system or tool safety rules. Other approved documents
with non-empty approved content are discoverable by title and readable through
the audited document tool; their bodies are never injected wholesale. A
draft-only document does not place its proposed title into the system prompt.

People represents every current human member with one **Human Profile**
card, including an explicit not-connected state when that member has no Human
Profile identity yet. The card owns the member's email, organization role,
**Report**, and **Learn about {member}** actions; People must not duplicate
the same people in a separate Members card. Invitation controls remain separate, and
**Learn about all members** belongs to the Human Profiles section header. An
existing Profile Report remains readable from its member card, but a
missing document exposes a creation link only when the document projection says
the current actor can manage Organization documents; otherwise the card
explains that owners and admins must create it. A single-member learning start
failure stays on that member's card with its retry action. **Learn about** asks
the designated Center Agent to process one member at a time and create one new
dated Profile Report. The all-members operation is
serial: one task reaches a terminal outcome before Core starts the next, and
one failure is recorded without stopping the remaining members. Research never
writes approved document content directly.

A verified member may also ask the Center Agent in an interactive conversation
to learn about them or create a fresh Profile Report. The model-visible action
is deliberately self-only: Core derives the subject from the verified speaker,
starts the same durable single-member research workflow, and never accepts a
model-selected user id. The Center Agent immediately says that the background
learning run has started and does not claim the new report is complete until
the research task reaches its terminal outcome. User-defined recurring learning
plans and proactive opt-in prompts for organization-wide automatic learning are
future extensions of this same workflow, not alternate document writers.

Human Profile cards use the same top-right action model as Agent Profile cards.
The icon row owns **Learn about {member}**, **Direct Message** for another active
Human Profile, **Edit Human Profile** for the signed-in member's own active
default Human Profile, and an overflow menu whose **About profile** item opens
the shared profile-details surface. The **Profile Report** action remains in
the card's content area and opens the latest report without a warning-style
review state. It is document content, not profile chrome. Self-Direct Messages are unavailable,
and owners or admins do not receive an edit action for another member's Human
Profile. Editing the current member's default Human Profile reuses the paired
Account Display Name mutation rather than introducing a second identity writer.

In an Organization workspace, each Human Profile card also shows one coarse
**OpenMeld Service** state for that member: **connected**, **needs attention**,
**not connected**, or **status unavailable**. This answers only whether at
least one current OpenMeld Service session for the member can carry Wake work;
it does not claim that any Agent Profile is ready. Every current Organization
member may see this coarse state. The surface never exposes another member's
computer name, device id, operating system, Service version, last-seen time, or
lookup failure detail, and it offers no action that would let one member manage
another member's computer.

The first-level **Computers** home is a separate Organization member surface,
not an expansion of this coarse Human Profile status. It groups cards by owner
and may project a computer display name only when an active ordinary Agent in
the current Organization Directory names that computer as its execution
relationship. The signed-in member's group continues to use their complete
account inventory. Other members' groups are read-only and show only the owner,
computer display name, and Organization-visible Agents using that computer.
They never expose platform, operating-system or Service versions, last-seen
time, local-agent inventory, raw failure evidence, or management controls.

The designated Center Agent may read that same coarse projection for one active
Organization member through
`openmeld_read_member_openmeld_service_status`. It must first resolve the exact
member `userId` from the Organization directory; Core rejects users outside
the current Organization before any Service lookup. The tool returns only the
member id and one of the four coarse states above, records an
`organization_member` audit entry, and never grants device management or
exposes device details.

**Profile Report** is the stable product term for this document so it does not
collide with Agent Profile or Human Profile identity. The persisted document
kind remains `member_profile`, and the orchestration contract remains member
research; those internal compatibility names do not appear as the document's
user-facing name. New work-profile reports default to
`{YYYY-MM-DD} — Work Profile` inside the managed folder for that person.

A member-research callback settles its native delivery and research task; it
does not publish a fabricated Center Agent Direct Message. A provisional report
may become available before that settlement finishes, so clients must not call
the research complete until its task reaches a terminal outcome. Completion
feedback is emitted only after that terminal outcome.

The server-authored task may use Organization directory identity, Slack
workspace directory identity metadata, approved Organization documents, the
bounded Agent Activity snapshot, and an Organization-shared GitHub connection.
Directory identity, email, role, profile ownership, source availability, and
the absence of activity are not evidence of a member's work. Slack directory
profile text is untrusted and Slack messages are not exposed. GitHub work is
included only when it can be confidently attributed to the subject. The task
must not read local agent session content or invent missing facts. V1 does not
expose Space message context because the existing generic read does not bind
public visibility and subject participation at its execution boundary.

Member research has a server-enforced quality floor. Remote Agent submits the
shared structured member-research report contract rather than authored
Markdown. Core validates the evidence packet, preserves the existing approved
`## About` section, and is the only owner that renders the reviewable Profile
Report Markdown. A useful evidence-backed report requires at least two
distinct, dated Agent Activity or attributable GitHub work items. It separates
supported About additions and adds a Working profile with Current focus, Recent
contributions, and Collaboration guidance before dated, source-cited Observed
activity. Research coverage names every checked source, its availability, the
time range, and stable evidence links or identifiers. If there is not enough
substantive evidence, Core renders **Insufficient evidence**, source coverage,
and a concrete next step; it does not manufacture a Working profile or
Observed activity from identity facts and missing-source notices. Invalid or
incomplete evidence packets are rejected before they enter document review.

### User-profile remote agents (explicitly deferred)

Once the remote controller type exists, any Agent Profile could technically
bind to a remote runtime. Product-wise this is **not exposed in MVP**:
offering it means operating a hosted-compute product (sandboxing, workspace
persistence, secrets, billing). Keep the schema and controller abstraction
free of "Center-Agent-only" hardcoding so this later becomes an opening, not a
rework — but build no product entry now.

## Agent Activity

Organization-wide coding-agent awareness is now the first-class **Agent
Activity** product. Its Projects, explicit local opt-in, metadata allowlist,
presence, retention, ingestion, digest, and read-surface rules are owned by
`developing/product/agent-activity.md` and must not be re-derived here.

The earlier Session Sync framing is retired. Provider-supplied session titles,
including provider-generated thread names, and reviewed source metadata are
shared Organization context. Full prompts, transcripts, replies, reasoning,
file contents, local paths, raw session ids, and arbitrary provider metadata
are not Agent Activity inputs.

Agent Activity is separate from Agent Profile Wake readiness and
RuntimeCoordinator execution truth. Organization directory presence cannot be
used as coding-session evidence, and coding-session presence cannot make a
Profile Wake-ready.

Web labels the product's first-level destination **Agent Activity** and uses
`/o/{orgSlug}/agent-activity`. The full label must never be shortened to the
generic **Activity** or reused for the Center Agent audit journal.

## MVP Boundary

In scope:

| Block          | Contents                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org tenancy    | Vercel-style mechanics; auto personal org; Better Auth organization plugin as-is; email-bound invitations + verification; `owner`/`admin`/`member`; org directory (members + Agent Profiles with existing presence); Spaces carry `organizationId` with `public`/`private` org visibility; `/o/{orgSlug}/...` routing                                                                                         |
| Center Agent   | System-managed `managedRole = "center_agent"` Agent Profile per org; designation table (multi-Center-Agent-shaped, MVP-constrained); derived `isCenterAgent`; hosted Remote Agent R1; concierge tool set plus verified member-attributed Task and Routine management; server-enforced CA-DM Space; isolated first-class Task conversations; member-scoped memory and default-on Organization memory; audit + attribution |
| Agent Activity | First-class Projects; explicit per-repository local opt-in; privacy-safe coding-session metadata; Organization-wide member visibility; Web, CLI, and read-only Center Agent awareness surfaces, as owned by `developing/product/agent-activity.md`                                                                                                                                                            |
| Carry-over     | Existing wake pipeline, Space DO, daemon/CLI, web shell — all re-scoped to carry `organizationId`                                                                                                                                                                                                                                                                                                             |

Out of scope (explicit, settled):

- Better Auth `teams` sub-feature (namespace reserved)
- Multi-Center-Agent logic (schema ready; logic and routing not built)
- User-profile remote-agent product entry
- Cross-org guests / external Space members
- Custom roles, dynamic access control, SSO/SCIM
- Billing (leave `metadata.plan = "free"`; AI Gateway gives per-org usage
  observability; `allowUserToCreateOrganization` / `organizationLimit` are
  the future plan-gating hooks)
- Autonomous Center Agent destructive permissions outside an explicitly owned,
  represented-member Core contract (draft-for-approval only)

Generic shareable invite links were removed from this out-of-scope list by the
2026-07-14 organization join link decision in `developing/decisions.md`.

## Implementation State And Remaining Order

1. **Org foundation** — shipped on main. Schema-level tenancy now includes the
   Better Auth organization plugin, auto personal orgs, memberships,
   invitations, org-scoped routing, `organizationId` on business tables, org
   Space visibility, and Binding authorization into an org.
2. **Center Agent loop** — shipped on main for the MVP surfaces: designation
   storage and contracts, server-side authorization, audit-backed
   Core/Gateway/API client surfaces, Web directory/badge surfaces, and
   hosted Remote Agent operation. Final DM replies project ordinary unread Inbox
   updates and the outer-rail unread dot. The hosted Center Agent may explicitly
   request the current verified member's response as normal, work-blocked, or
   material-failure-risk impact; only the latter two are urgent, and the
   member's next reply resolves the open request. Acceptance remains
   dogfood-driven: one DM conversation with the Center Agent should produce a
   running, populated Space in our own org.
3. **Remote Center Agent runtime** — shipped on main as R1 on 2026-07-09. It
   attaches to the **same designation**; switching runtime preserves identity.
   Flue harness, native delivery, Space reply streaming, Slack channel support,
   ledger semantics, and operator boundaries are owned by
   `developing/product/remote-agent-runtime.md`.
4. **Center Agent memory** — shipped on main with member-scoped Center Agent DM
   memory, default-on Organization memory for shared Space and Channel
   conversations, explicit organization remember, and member/organization
   deletion paths.
5. **Center Agent Routines** — implemented as organization-owned definitions
   and Runs with explicit Space or Slack-thread destinations,
   represented-member management, Core-owned scheduling, and Remote Agent
   native delivery. Its contract lives in
   `developing/product/center-agent-routines.md`; official-organization
   configuration and a real dogfood Run remain external validation.
6. **Center Agent task coordination** — multi-child barriers, partial
   outcome snapshots, failure-only fallback activation, and Parent Stop
   propagation are shipped on main. Core-owned exact-task subscriptions observe
   child success, failure, stop, silence, and publication failure, then create
   only the explicitly declared continuation. General exact-task watch is also
   shipped for Space Wake and hosted native-delivery Task Handles. Parent
   continuation uses the observer Native Delivery's frozen Space, DM, Slack, or
   Message Channel destination and does not store a second route in the
   subscription. It observes independent work without taking ownership of it.
   Exact Codex and Claude Code controller-native callbacks and bounded task
   discovery are shipped for the supported registration, neutral-terminal, and
   Claude-task success conditions; unsupported controllers and conditions,
   including current controller `failed` and `needs_attention` watches, fail
   closed.
7. **Center Agent Tasks** — target product and architecture are owned by
   `developing/product/center-agent-tasks.md`. Implementation is in progress;
   owner docs and partial schemas or routes are not evidence that Task creation,
   cross-channel continuity, realtime refresh, or recovery is released.
8. **Agent Activity** — implementation is in progress under the first-class
   Project, privacy, ingestion, presence, retention, and read contracts in
   `developing/product/agent-activity.md`.

Dogfooding is the validation strategy: the first org is us; OpenMeld is built
inside OpenMeld.

## Known Risks And Mitigations

- **DO concurrency trap**: one-DO-per-org Center Agent serializes all members.
  → Conversation-scoped instances; shared policy and memory are externalized
  behind Core-owned contracts.
- **Tool-surface drift** between local and remote Center Agent. → Single Core
  API layer; role template and system prompt from one source.
- **Privilege escalation via hosting**: operating the hosted runtime must not
  grant organization authority. → Core enforces designation and scoped tool
  contracts on every call; privileged actions remain attributed and audited.
- **Prompt injection through the Center Agent**: members steering the Center
  Agent to act against others. → Core-owned represented-member authorization,
  on-behalf-of attribution, audit journal, prompt confirmation where required,
  and no autonomous destructive authority.
- **Migration bias**: carried-over ATS code assumes user-centric ownership. →
  Schema is written org-first; carried code adapts to the schema, never the
  reverse.
- **Invite friction**: email-bound invitations need mail infra on day one. →
  Cloudflare Email Service is selected for org-foundation auth email.
- **URL regret**: org scope cannot be added to routes after launch without
  breaking links. → `/o/{orgSlug}/...` from the first route.

## Drift Control — Hard Red Lines

A coding agent working in this scope must not:

1. Rename `organization` to team/workspace at any layer, or name any
   top-level product concept "Team".
2. Enable the Better Auth `teams` sub-feature.
3. Remap Better Auth model/field names or wrap it in a naming-translation
   layer.
4. Put business fields into Better Auth tables.
5. Allow more than one Center Agent per org (the unique constraint stays until
   Felix lifts it).
6. Add an `isCenterAgent` flag to Agent Profile storage (derive it).
7. Expose local-agent-backed or bring-your-own Center Agent runtime selection
   before the redesign meets the hosted-runtime feature bar. The
   OpenMeld-operated Remote Agent's native delivery path is defined in
   `developing/product/remote-agent-runtime.md` and is not a precedent for
   other side channels.
8. Grant the Center Agent autonomous destructive or non-additive authority.
   Member-attributed Routine management is allowed only through the verified
   speaker and shared Core authority contract in
   `developing/product/center-agent-routines.md`; it is not a precedent for a
   broader exception.
9. Build a DM subsystem (DM = lazy private Space).
10. Collect prompts, prompt-derived summaries, transcripts, replies, file
    contents, local paths, or arbitrary provider metadata for Agent Activity,
    or report a repository without explicit local Project opt-in.
11. Expose user-profile remote-agent binding as a product surface.
12. Ship org routes without the `/o/{orgSlug}` scope.
13. Start building billing, SSO, custom roles, or cross-org guests.
14. Turn Center Agent Tasks into a second Agent Task Coordination registry, a
    transcript mirror, or a general backlog/workflow engine. Follow
    `developing/product/center-agent-tasks.md`.

If a task seems to require crossing one of these, stop and surface it to
Felix; do not "helpfully" cross it.

## Vocabulary Seeds (pre-glossary)

These terms enter `developing/glossary.md` with code anchors once
implemented; until then this section is their definition source:

- **Organization (org)**: the single tenancy/resource container. Personal
  orgs are ordinary orgs.
- **Center Agent**: the org's resident coordinator Agent Profile. Generic
  product/type name (like "admin" names a role) backed by one system-managed
  `managedRole = "center_agent"` profile per org; its Center Agent identity is
  shown via the managed role plus designation-derived badge, never read from a
  name.
- **Designation**: the org-level pointer record that makes an Agent Profile
  the org's Center Agent and carries its privileges.
- **Concierge loop**: the MVP Center Agent loop — need in, configured running
  Space out.
- **Ambient session**: a local agent session started by the user directly
  rather than by a Wake, observable only under an explicitly bound Agent
  Activity Project.
