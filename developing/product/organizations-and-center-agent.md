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
  semantics (`developing/product/space-collaboration.md`), or runtime
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
Center Agent memory. Center Agent Routines are a separate
first-class product surface owned by
`developing/product/routines.md`. The former Session Sync
direction is now the Agent Activity product owned by
`developing/product/agent-activity.md`. The Center Agent Web homes and retired
management-panel mapping are approved target state as of 2026-07-13 and land
through W-NAV1..5. Further implementation must follow this baseline; deviations
require Felix, and the change must land here and in `developing/decisions.md` in
the same PR.

## Member departure and asset boundaries

Leaving an Organization and being removed by an administrator use the same
member-departure lifecycle. Check Space ownership handoff and Center Agent
identity, durably prepare private Session Inventory cleanup, then remove the
membership. Finalize cleanup only after the native membership operation succeeds.
Failed authorization or a rejected departure must not purge personal memory.
The inventory cleanup waits for authoritative membership removal and retains its
existing retry path. Center Agent member memory uses the existing provider
deletion path and failure logs; this is not a guarantee of completed remote
erasure when that provider is unavailable.

Administrators can resolve Space ownership through an explicit preview and
preparation in the Organization's member-removal flow, even if the departing
person is unavailable and the administrator has not joined their Spaces. This
requires a current human owner or admin with `member:delete`; the administrative
endpoint excludes self-removal and removal of an Organization owner. Its preview
discloses only the affected Space IDs, names, and actions, without granting the
administrator access to their contents or adding them as a member.

Preparation closes an eligible solely used private Space to retained read-only
history, demotes the departing person when another owner remains, or assigns an
explicit successor. Eligibility considers every historical participant and the
current access, invitation, and unsettled-work state; `Welcome Space` is not a
privileged name. A selected successor must be another current Organization member
with an active Human Profile and receives Space membership and ownership, including
access to private history. Confirmation must make that access grant explicit.
The complete Space-owned rules live in `space-collaboration.md`.

These explicitly confirmed Space changes happen before the existing native Auth
member removal. They persist if preparation partially succeeds or native removal
later fails. The UI reports the incomplete removal and refreshes the plan for an
explicit retry; it must not claim rollback or automatically replay the mutation.
Native permission checks, last-Organization-owner protection, Space ownership
references, and post-removal private-data cleanup retain their existing owners.

| Operation / asset | Boundary |
| --- | --- |
| Leave a Space or Organization; revoke membership | Remove the access grant, not shared messages, files, revisions, or attribution. Public link access remains an independent grant; close it separately when confidentiality requires it. |
| Space ownership | Resolve active ownership before membership removal through handoff or explicitly confirmed eligible solo-Space closure. Creator attribution alone grants no access. Keep last-owner protection for active Spaces and restrictive membership references. |
| Team Files, Space Files, Organization Skills, Center Agent | Keep them with their owning Organization or Space. A creator's departure must not delete them or create a second ownership model. |
| Member-private Files and local agent sessions | Do not transfer them into Team Files or grant administrators ordinary read access. Private file retention is separate from member removal; see `files.md`. |
| Private Session Inventory and member-specific Center Agent memory | Use the shared departure cleanup. This does not delete work already published into a shared Space. |
| Explicit file deletion | Use the existing trash and restore mechanism. An independent copied revision is not deleted with its source. |
| Explicit Skill removal | Disable use while retaining immutable releases and audit evidence under the existing Skill lifecycle. |
| Explicit Space deletion | A human Space owner, or an authorized administrator preparing an eligible solo-Space member removal, confirms retained read-only closure. Shared history is preserved. Pending Wake work blocks closure; member-removal preparation requires a successor instead. See `space-collaboration.md`. |

This deliberately separates access revocation, shared work retention, and explicit
content deletion. It follows the purpose of
[Slack deactivation](https://slack.com/help/articles/204475027-Deactivate-a-members-account),
[Slack channel deletion](https://slack.com/help/articles/213185307-Archive-or-delete-a-channel),
[Lark offboarding](https://www.larksuite.com/hc/en-US/articles/360048487851-admin-delete-members-and-reallocate-resources),
and [Feishu offboarding](https://www.feishu.cn/hc/zh-CN/articles/360043223853-管理员操作成员离职及转移资源).
It does not copy their enterprise resource-transfer consoles or promise indefinite
retention. Existing recall, trash, retention, and permanent deletion rules still apply.

Account deletion is an account-wide operation in Settings > Account. The server
previews the affected workspaces and checks the same inventory again at acceptance.
A workspace with other members remains; its last owner must first appoint another
owner, and Space owners must complete the existing ownership handoff. A workspace
with no other members closes, including its shared links and guest content.

Acceptance revokes sessions, sign-in credentials, device codes, personal profiles,
and memberships, and replaces the account identity with a non-signable tombstone.
Shared messages, published files, Skills, revisions, and audit attribution remain
with surviving teams. Historical text and author snapshots are not rewritten.
Private Files roots (including former memberships), personal Computers, private Agent conversations,
synced Session Inventory, personal memory, and personal App connections are erased
through their existing owners. Team-level connections remain with a surviving team.
Closing a workspace also disconnects its Channels and Apps and deletes its assets.

Auth owns acceptance and the durable cleanup request; Core coordinates owner-specific
erasure. Storage or provider failures remain pending and retry. The success page
says that the account is closed and cleanup continues, not that every remote byte
has already disappeared. Legacy Center Agent Computers shared across conversations
remain team assets while that team exists; isolated private Computers are erased.
Membership departure alone is not account deletion or complete personal-data erasure.

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

- Do not build a heavyweight task/workflow system. Agent Task Coordination records exist only to
  connect exact executions, terminal outcomes, and declared continuations; they
  are not a product task registry or a general workflow engine.
- Do not add agent features for their own sake; every pillar must shorten or
  strengthen a real organization's work loop.

The three pillars interlock: Organization is the container, the Center Agent
is the brain, and Agent Activity is the perception. They ship container first,
then brain, then perception (see Implementation Order).

### OpenMeld Kernel and Center Agent intelligence contract

**OpenMeld Kernel** is the canonical name for the small, stable,
model-visible contract that teaches every Center Agent turn what OpenMeld is,
the value it should create, the core product objects and authority boundaries,
and what counts as a completed user outcome. It is part of the Center Agent's
system prompt. It is not another context store, planner, router, workflow
engine, or source of runtime truth. Ordinary user-facing replies explain the
relevant product idea in natural language; they do not make users learn the
internal `OpenMeld Kernel` label.

One user task has one answer owner: the ordinary Center Agent turn that sees
the verified requester, current message, relevant conversation history,
Organization context, and tool results together. Context assembly, tool
discovery, Slack search, policy checks, and delegated work may supply evidence
or enforce an action boundary, but none may independently reinterpret the task
or seize its answer ownership. A delegated Agent reports directly only when the
Center Agent explicitly chooses `child_reports_directly` because that result
fully satisfies the request and no parent continuation remains. Otherwise only
the Center Agent turn closes the task; Core publishes that one result or an
explicit execution failure.

The Center Agent first forms a situation model from the admitted turn envelope,
relevant conversation history, and current tool results: what the user is
trying to achieve, what earlier question or action the current message
completes, which facts are trusted, what remains unknown, and what OpenMeld can
do next. This is the Agent's current semantic judgment, not a second persisted
`Situation Snapshot` object or a pre-routing model. It then chooses tools
because they advance that goal. Tool availability never turns search, setup,
delegation, or another capability into the goal by itself.

That situation model keeps three meanings separate: **observed facts** record
what actually happened with its known time and scope, **current status** says
what is true now, and **pending plan** says what may happen next. A new status
may replace an older status without deleting the historical event. A plan is
not evidence that its action occurred. A scoped statement such as "not yet
after this checkpoint" must not become "never happened." When compressed
history conflicts with traceable conversation or tool evidence, the Center
Agent preserves the scoped conflict and treats the answer as unknown until the
evidence resolves it. This is a context-compilation invariant, not a second
state store.

Context compaction mechanically rebuilds a bounded action-evidence projection
from the active canonical conversation path on every checkpoint. The semantic
summary may interpret those events, but it cannot replace the fresh projection
with an older model-authored claim. The projection proves only recorded tool
calls and their error or non-error results; it does not widen authorization or
assert an external side effect that the recorded result cannot prove.

Before using a tool, that same Center Agent decides whether the goal and target
are sufficiently specified. When one required detail is missing and trusted
current context does not support a safe inference, it asks one concise question
instead of searching to guess or enumerate possible targets. It starts with the
current conversation and the smallest likely-sufficient evidence source,
broadens only after material insufficiency or conflict, does not repeat an
equivalent read or query without new scope, and stops once the evidence supports
the requested decision or outcome. Latency and tool cost are part of that
judgment. This is an intelligence contract, not a keyword classifier, fixed
search budget, second model, or pre-agent gate.

For interactive Space work, the Space persists one work-target record containing
the requested goal, selected code repositories, and separate issue destinations.
Each admitted source selects new work, corrects the same goal, or inherits it.
The source is then bound immutably to that goal. A late callback follows its
original source binding even after a new request changes the conversation's
default. A retry reads newer corrections without overwriting them. Selection
compares both the observed revision and source identity. An explicit earlier
source reference can continue that goal without merging conversation histories.
Defaults are scoped to the source author and logical conversation; an Agent's
independent request cannot replace a Human's default. Correcting a non-Task goal
requires its original requester. Task corrections use the existing Task roles.

Core derives the source and logical conversation from live native admission.
The worker request's `taskId` remains a per-Wake execution identifier and never
selects a goal. The Space Task owner resolves real Tasks only from the original
message's Task draft receipt or its exact retained Task handoff and Wake tuple.
Agent-authored handoffs require the current Task role. Plugin connection and
action continuations resolve their authenticated original source chain.
Ordinary messages do not create Tasks to store this context.
This record is a context constraint, not a Situation Snapshot, work planner,
Project association, permission grant, execution ledger, or completion state.
Its `requestGoal` describes the current requested operation; the Task's declared
deliverable and completion conditions remain solely in the existing Task owner.
The same Center Agent interprets the request; no second model or task-text router
chooses the target. Each delivered input refreshes the current record after the
runtime has durably applied that input and before the model starts. A failed
context read must leave the admitted correction available to the next continuation.
Every repository operation reads the owner again, including after compaction or
rollover; a compressed model summary cannot replace the current record.
Structured provider operations and repository publication must agree with it;
an unrelated tool result never changes it. Explicit multi-repository work selects
those repositories together. An issue destination does not replace the code target.

The Kernel also teaches stable interaction mechanics that affect whether the
user's next step can work. In an ordinary Space, a human must explicitly Wake
the intended Agent Profile with an `@` mention; only a current one-to-one Agent
Direct Message auto-dispatches an ordinary human message without a mention. If
the Center Agent sends a user to an ordinary Space and expects a reply or
action, its guidance must explain how to Wake the Agent instead of merely
saying "reply here." This is product self-knowledge, not a routing rule or a
replacement for the Space addressing contract.

Permissions constrain effects at the execution boundary; they do not replace
the model's semantic judgment with a narrow router. Tool and context catalogs
use progressive disclosure so the same general Agent can remain capable
without loading every schema or transcript on every turn.

The hosted Center Agent freezes one executable capability catalog at turn
start. When that catalog has progressive discovery and Code Mode, every
tool-capable primary model receives the same small bootstrap: typed search and
describe tools, Code Mode, the generic Connected App entry points, and the
bounded read-only member tools. The
foundational reads keep current OpenMeld state directly inspectable for models
that do not begin with a meta-discovery call. The worker never reads the user's
words to preselect a hidden business-tool slice, and it does not maintain
per-model tool-count rules. The primary model decides whether to use a
foundational read or what to search for. That explicit search uses the same
code-owned capability catalog, stable namespaces, multilingual search aliases,
and deterministic ranking. Search returns bounded names, namespaces, and
summaries, describe returns the selected capabilities' model-visible JSON
schemas, descriptions, and declared prerequisites, and Code Mode executes only
members of the frozen catalog. A catalog match proves only that the capability
exists in this turn.
The capability owner still decides current authorization, eligibility, and the
execution outcome. Runtime validation remains authoritative for normalization
and custom constraints that JSON Schema cannot express. Discovery does not add
permissions, mutate the catalog, persist a second capability state, or make the
model guess an undeclared field. The ranking layer answers an explicit model
search only; it never interprets the raw user request, authority, or task intent
and never becomes a second task router. Provider context capacity is enforced
from the frozen model route rather than a universal tool-count constant.

All model-visible tools use structured calls and strict structured results.
Malformed, parallel, incomplete, or unknown tool protocol fails closed inside
the Agent loop. Raw tool syntax, provider payloads, or orchestration tags must
never appear as rendered user-facing prose. A genuine Markdown inline-code or
fenced-code example may display protocol-shaped text, but it is never treated
as a call.

Tool activity crosses the publication boundary only as typed runtime events.
Ordinary assistant prose that renders reserved provider call/result protocol is
invalid output: OpenMeld stops its stream, publishes one safe explicit failure,
and retains bounded diagnostic evidence. It never turns text into a real tool
call, never uses a regular expression to infer that an action occurred, and
never exposes raw chain-of-thought. Valid typed tool events and provider
evidence remain available to structured diagnostics and future presentation.

The runtime also enforces bounded progress without becoming a second planner.
One assignment has a durable, configurable total tool-call safety ceiling that
survives internal retries and compaction. Normal work remains in the same
execution; the ceiling reports incomplete work instead of requesting another
budget segment. Center and personal hosted roles share this execution rule
without sharing tool permissions. Only tools explicitly
classified as observation-only participate in result-aware stall detection;
the runtime compares bounded fingerprints of the tool name, input, and result
and rejects a third unchanged observation, including alternating probe loops.
It does not inspect keywords, store raw inputs or outputs, or infer that an
effectful tool is safe to repeat. The Center Agent remains responsible for
choosing the next useful action and finishing with the evidence it has.

When one authorized task requires multiple external writes, that same answer
owner executes them in the user's requested or dependency order and waits for
each owning capability's structured result before starting the next dependent
write. Every capability that accepts an `operationId` receives one stable ID
per distinct effect; an exact retry reuses the same ID, while another effect
uses another ID. A failed or outcome-unknown step stops dependent later writes
and produces an explicit partial-outcome report. A capability-owned durable
batch remains authoritative when one exists. OpenMeld does not add a second
generic transaction engine or pretend unrelated providers can commit atomically.

## Pillar 1 — Organization (Tenancy)

### Mechanics: Vercel-style, single container type

There is exactly one resource-container type: the **organization**.

- Sign-up auto-creates a **personal org** (the user is `owner`, sole member).
  Its `name` is the user's name at the data level and its slug is human-friendly
  (derived, reserved-word-checked, editable). The Web workspace switcher may
  label this pinned navigation context **Personal**; that presentation label is
  not the Organization's stored name or a second tenant type. The personal org
  otherwise uses the same code path as any org except the solo guard below.
- Every resource (Space, Agent Profile, Binding, Center Agent designation)
  belongs to exactly one org via `organizationId`.
- A managed Center Agent profile is Organization-exclusive. It may participate
  only in Spaces owned by the same Organization. Authorizing one of its
  Bindings into another Organization never makes the managed profile eligible
  for that Organization's Directory, Space membership, readiness, or Wake.
  Ordinary workstation Agent Profiles follow the same Organization identity
  boundary: they may be listed, added, readied, or woken only inside their own
  Organization. An Organization's own designated Center Agent may still join
  that Organization's ordinary Spaces.
- Users can belong to many orgs (membership). Auth stores the account's last
  explicitly selected Organization as a durable entry preference; Web exposes
  selection through the single workspace switcher defined in
  `developing/clients/web.md`. The current Organization in an explicit Web URL
  remains tab-local and does not mutate the Better Auth Session active org.
- The personal org is **permanently solo** (settled 2026-07-05, amending the
  earlier grows-into-a-team direction): it never takes members, and the
  server rejects invitations to it (marked via organization `metadata`
  `personal: true`; fail closed). Collaboration starts by creating a new
  organization; existing Personal Workspace Agent Profiles remain in Personal,
  and users create Organization-specific Agent Profiles where collaboration is
  needed. Spaces and Profiles do not migrate between orgs (deferred).
  Presentation rules live in
  `developing/product/presentation-progressive-disclosure.md`.

Rejected: GitHub-style dual entities (User and Org both own resources). That
model forces `owner: User | Org` unions through every permission check and
makes personal→org growth a painful resource migration. Rejected in
discussion; do not reintroduce it.

Center Agent ownership follows this tenant model in both collaborative
Organizations and Personal Workspaces. The managed Profile and hosted Binding
belong to the Organization; `ownerUserId` is null. `createdByUserId`,
`designatedBy`, and `pausedByUserId` are nullable audit attribution, not ownership
or authority. Deleting or removing a creating member must preserve the Profile,
designation, Binding, configuration, and history. Personal Agents remain owned
by their users within one Organization.

Management permission does not grant access to private Spaces, other members'
Center Agent DMs, private memory, tasks, or App credentials. Center Agent Space
membership cannot confer personal access on an administrator or creator. Native
tool calls identify the Center Agent itself; actions on behalf of a person must
carry separately verified member attribution.

Migration, persisted Space access, and cross-client release constraints are
owned by [Organization Agent ownership](../architecture/organization-agent-ownership.md).

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
  org creation; the session-create hook sets `activeOrganizationId`. Each Auth
  user has at most one personal Organization. PostgreSQL enforces that invariant with a
  partial unique index over the existing canonical facts:
  `created_by_user_id` where valid Organization metadata has `personal: true`.
  Concurrent first sessions resolve the same winning Organization and converge
  on its single owner membership instead of creating parallel personal contexts.
- Auth owns new Organization URL allocation. Web submits the display name only;
  Auth derives a readable base, appends a six-character cryptographically random
  public discriminator, and delegates the resulting create to the Better Auth
  Organization API. The existing `/organization/create` request may accept and
  ignore the legacy client `slug` field during deployment compatibility, but no
  client value or ordinal suffix is a creation authority. Personal Organization
  creation uses the same allocator. The database unique index is the final
  constraint and exact collisions are retried.
- Roles: the plugin's default three — `owner`, `admin`, `member`. No custom
  roles, no dynamic access control in MVP. Org-scoped permission statements
  (via `createAccessControl`) carry our resources (for example
  `space: [create, ...]`, `centerAgent: [designate]`) on those three roles.
- In Organization Settings, an Owner may change another Owner to Admin or
  Member when another Owner remains. The current Owner's own row stays
  read-only, and Admins and Members cannot edit Owner roles. Demotion requires
  confirmation and preserves membership and assets; member removal keeps its
  separate Space-handoff flow. Auth remains the sole membership writer and
  retains its native permission and last-owner checks. PostgreSQL additionally
  rejects concurrent writes that would leave retained members without an
  Owner, using the existing Organization row lock. Empty membership sets and
  closing Organizations remain compatible with the native deletion lifecycle.
  Owner promotion and broader ownership-transfer UI remain deferred.
- Invitations are the plugin's email-bound invitations (accepting requires a
  session whose email matches the invite). Email verification is on from day
  one; set `requireEmailVerificationOnInvitation` per its documented
  semantics. Owners and admins may send invitations directly. Ordinary members
  submit recipient-bound invitation requests for owner/admin approval; they
  never receive the native invitation-create permission.
- Auth remains the only writer for join-link creation, reset, and revocation.
  Any verified Organization member may ask the Center Agent to read and share
  the current active link through a private Core RPC without a second
  confirmation. On an explicit share request, the Center Agent may also ensure
  that an active link exists on behalf of that verified member. Auth reads the
  member's current server-side role. Owners and admins ensure a direct link;
  ordinary members ensure a request link. A direct link lets a signed-in,
  verified recipient explicitly join as a member. A request link requires an
  owner or admin's decision. Mode belongs to the stored link, not its bearer.
  Ensure reuses an unexpired link of the same scope and mode, or replaces an
  expired one. It never rotates another live link. Owner and admin
  management surfaces are Web Settings and `openmeld org invite-link`: both may
  manage links while Auth remains the permission authority and writer.
  Legacy management clients without an explicit mode continue managing request
  links. Web Settings and the avatar Invite dialog use direct links for admins.
  Members may read and share request links,
  but cannot reset or revoke them. The Center Agent cannot email
  invitations. Personal organizations reject both join-link creation and
  acceptance.
- Core owns `organization_join_requests`, shared by email and link entry, with
  an optional ordinary Space target. For a member's email request, approval sends
  the existing email-bound invitation for the recipient to accept. For an explicit
  verified recipient request, Core records `applicantUserId`; after approval Auth
  fulfills membership and optional Space access before Core records `joinedAt`.
  No second invitation acceptance is required. Owners and admins all receive an
  normal-priority Inbox review and transactional review email through the existing delivery
  ledger. Any one may approve; another may retry incomplete fulfillment. Approval
  remains actionable until delivery or joining succeeds, then all reviewer items
  resolve. Pending decisions appear under **Needs review**; approved incomplete
  fulfillment appears under **Needs action**. New Web callers use an explicit
  retry action, so a stale approval cannot repeat fulfillment. Settings retains
  shared decision records with the original reviewer and time; retries do not
  replace that attribution. For an Organization-only email request, approval or retry completes
  the request with `joinedAt` when Auth's account identity projection confirms
  the recipient is already a member. It does not send another invitation, claim
  email delivery, or grant access. Organization membership alone does not complete
  a request targeting a Space. There is no configurable policy or multi-stage
  approval. Targeted Space guest invitations are separate: acceptance grants only Space membership,
  never Organization membership or Organization reviewer authority.
- Links are scoped to the Organization or one Space, with one active link per
  scope and mode. New links expire after 30 days and can be revoked. Existing
  links retain request mode. Direct links require their creator to remain an owner
  or admin; ordinary members cannot retrieve or create a direct link. Unattributed
  Center Agent read/share operations only expose request links.
  Space sponsorship is checked separately from Organization reviewer authority,
  both at approval and at Space invitation fulfillment.
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
- **Core (PostgreSQL) owns business resources**: Spaces, Agent Profiles, Bindings,
  Center Agent designations — each carrying an `organizationId` reference.
- Do not put business fields into Better Auth tables via `additionalFields`.
  Business mutations need our own validation, audit, and side effects; hiding
  them in auth hooks was considered and rejected.

### Devices and Bindings under org

- Devices and OpenMeld Service Runtimes stay **user-owned**. They may serve
  Agent Profiles from multiple Organizations without making those Profiles
  portable.
- Every ordinary workstation Agent Profile has one canonical Organization from
  creation. Its enabled primary Binding is execution infrastructure for that
  Profile; it is not a grant to another Organization.
- Directory projections, Space member mutations, readiness, and Wake compare
  the Profile's canonical `organizationId` with the target Organization and
  fail closed when identity is missing or mismatched. Legacy authorization
  records, preferences, and rebind history never override this rule.
- Rebinding a Profile preserves its Organization. It never carries access to a
  different Organization and never writes a future-authorization preference.
- Center Agent-created ordinary workstation Profiles use the Organization in
  the represented-member request. Remote Agent native delivery and the
  Organization-managed Center Agent remain governed by their own runtime and
  designation contracts; neither is a portability mechanism for ordinary
  workstation Profiles.

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
  the client UI, never in the server. A Space belongs to exactly one org.
  An Owner may explicitly enable targeted external guest invitations; guests must
  sign in and receive only that Space's access. This does not publish the Space
  on the internet or grant access to the Organization Directory. Guest access is
  independent of internal discovery and may be disabled without removing internal
  members. Anonymous participation is deferred.
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
its identity, status, and configuration in **Center Agent → Center Agent
settings** rather than duplicating them in a separate About surface.

New profiles default to "<Organization name> Center Agent" so they remain
recognizable across Organizations. A missing or blank Organization name falls
back to "Center Agent", and an Organization name that already ends with
"Center Agent" is not given a duplicate suffix. Existing profiles are not
renamed by ensure. Center Agent settings let an authorized organization owner
or admin open an avatar dialog with Bots, Colors, and Custom image choices.
Bots offer Original, Balanced, and Soft palettes. The live preview follows the
pointer and plays the library animation on click; reduced-motion preferences
turn off that motion. Changes apply only after Save. An unset avatar uses Clover.
The managed Profile stores `avatarStyle` and `avatarOptions` together, so all
members see the saved palette, color, or image. Auth owns that atomic write;
Core checks Organization permission and designation before storing a custom
image in the account-avatar bucket. Gateway decodes and normalizes uploaded
images through the shared identity-image pipeline. The editor does not accept
arbitrary image URLs. Future customization of the
role description or instructions also edits
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

### Organization working language

A non-personal Organization may have one optional **working language**. It is
an advisory to the Organization's Center Agent and Local Agents, not a locale,
translation setting, response constraint, or deterministic classifier. The
preference has exactly two modes:

- `automatic`: no row means that no reliable Organization-wide language has
  been observed. Trusted Center Agent member research may record or replace one
  BCP 47 language tag when the work evidence is clear. Mixed or insufficient
  evidence leaves the current state unchanged.
- `selected`: an Organization owner or admin explicitly selected one BCP 47
  language tag. Automatic observations never overwrite it. The same roles may
  return the Organization to `automatic`; an ordinary member may ask about the
  behavior but cannot change it.

Core is the single authorization, storage, revision, and audit owner. The
Center Agent tool accepts a mutation only for an explicit current-user request
and Core resolves the represented member and current role server-side.
Personal Workspaces do not persist this state. Web exposes no direct setting in
this release; the Center Agent is the management surface.

The Agent performing the work remains the final language judge. It decides
semantically in the same inference that creates the response; OpenMeld does not
run keyword rules, a text-language detector, or a second judge model. The order
is intentionally contextual rather than a rigid scoring algorithm:

1. An explicit language instruction from the current user wins.
2. A complete, self-contained current request clearly written in one language
   uses that language for that response. A fully English request therefore
   receives an English answer unless the user explicitly asks otherwise, but
   one such message does not reset the conversation's established language.
3. A short fragment, proper name, identifier, `@handle`, URL, number, or answer
   to the Agent's follow-up inherits the established conversation language.
   `Fangyuan`, `Yes`, and `OK8` complete the existing task; they are not new
   English-language requests.
4. The established conversation language changes only when the user explicitly
   asks to continue in another language or a sustained sequence of complete
   requests establishes a new language context.
5. The current conversation, Slack thread or channel, Space, intended audience,
   requested artifact, and a Local Agent owner's established habits outweigh
   the Organization hint when they clearly point elsewhere.
6. The Organization preference is a fallback for ambiguous work, including
   agent-to-agent collaboration. Genuinely unclear cases use English.

When an Agent authors the first message, handoff, or delegation for a new work
surface, it decides the language from the upstream user request, established
conversation, intended audience, and requested artifact before writing. Its own
generated text is an outcome of that decision, not new language evidence. If
the upstream signals remain unclear, the Organization preference remains
advisory input, and the receiving Agent judges again from its full semantic
context. This rule does not create language state on a Space, Task, Routine, or
document.

A new Web conversation without connected work context follows the current
request and never turns that one message into Organization state. Ordinary
messages on any surface cannot mutate the preference. Product terms, code,
identifiers, machine contracts, and internal maintenance text remain English
where translation would reduce precision.

### Web product home

The Center Agent has one Web product home with complementary destinations:

- **Center Agent** is the conversation home for the workspace's managed agent.
  Its header contains **Messages, Tasks, Graph, Files**. Skills management belongs
  to Team at `/o/{orgSlug}/skills`. Conversation information remains on the
  conversation surface.
- **App Settings → Center Agent** shows one page with **Channels** and **Memory** sections below the general settings. The general settings
  contains model information, identity, the Audit Log, and the reversible
  **Pause Center Agent** control. Channels and Memory reuse the existing provider
  cards and memory controls. Legacy Channel and Memory URLs redirect to the
  settings page, preserving OAuth callback results. Current Organization owners and
  admins may pause or resume it. Web and Core enforce the same current membership
  permission. Creation history grants no additional authority.

### Center Agent sessions

One Center Agent supports multiple independent chat sessions on the same Computer.
The session selects conversational context; it does not create another Agent or
Computer. Existing Space/session authorization, execution controls, and native
delivery own admission, steering, stopping, and results.

The separate private Center Agent Task product is retired. Its historical
records, routes, recovery scheduler, and session-scoped board do not return.
Ordinary shared **Space Tasks** are a distinct Space-owned collaboration
capability and are intentionally unavailable in the Center Agent Direct
Message. Local Agent Task Handles and Agent Task Coordination remain execution
selectors and callbacks; they are not Space Tasks. Historical private Task data
is not migrated into either sessions or Space Tasks, and old Task links do not
revive a Task.

Task tables and their schema declarations are retained only for safe deployment
ordering. No active product code reads or writes them. Inbox reads filter to
currently supported item kinds, including counts and notification delivery.
Physical deletion must follow deployment of all retiring producers; do not put
destructive table removal into the ordinary database-before-Core release.

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
hashes instead of copying Chat text into PostgreSQL. This makes the interaction
discoverable without turning the Audit Log into a second transcript.

Downstream provenance reuses the existing native-delivery correlation on the
Audit Log row. Core accepts it only when the active delivery matches the exact
Organization, designated Center Agent, represented Human Profile, and user.
The read projection resolves the Local Agent client from the original request
entry; it does not copy a client label into every artifact or create a second
source ledger. A direct Web, CLI, Slack, or Channel action without that exact
Local Agent request remains unlabelled rather than being guessed.

### Computer setup assistance

Computer care reuses these reads and controls. A targeted
`openmeld_list_computers` read includes path-free Local Agent diagnostics and
`care`: current connection lookup, last heartbeat, supervisor response
evidence, and the last acknowledged Execution Host observation when supported.
Host observations carry their own time and incarnation, not process IDs or
paths. A missing observation is unknown; an unresponsive Host does not imply
that accepted work stopped. Local counts do not identify affected cloud tasks.

For a specific task, Center Agent reads the existing Wake progress and execution
recovery projections, including device wait, pending interaction, stop
eligibility and pagination. It must not infer the occupying application's
identity from a conversation writer conflict or attribute all queued work to
one blocker. It may combine authorized observations to investigate, but does
not create a second scheduler or maintenance state machine. Existing owner
controls retain their authorization and confirmation rules; after a mutation,
Center Agent re-reads its operation or owning projection before claiming repair.
No arbitrary local shell, process termination, lock deletion, or boundary
bypass is introduced. Team-safe reads remain separate from private diagnosis.

The Center Agent may help the represented member connect a new computer,
reconnect an existing computer, or install a required OpenMeld Service update.
Before recommending one of those actions, it reads the Core-owned current
computer projection through `openmeld_list_computers`. The projection returns
the exact `connectedComputerId` used by Connect, a coarse status, current-device
identity, reason codes, and one recommended mode: `setup`, `reconnect`, or
`update_service`. On an explicit owner-level read in a requester-private
conversation, the same tool also returns the represented member's model-safe
Local Runtime inventory, current-computer reply diagnostics, OpenMeld Tools
versions and update state, Local Agent status, installed version, update state,
capabilities, model display names, check evidence, and a path-free File Access
summary. Controller accounts, executable paths, launch arguments, update
commands, raw diagnostic messages, private skills, and local policy never enter
the Center Agent result. File Access exposes only mode, revision, updated time,
and selected-folder count; local folder paths never enter the Center Agent
result.

Core binds that private read to the turn's verified represented human member
and requester-only audience, and fails closed before reading inventory when the
speaker identity or private audience is missing, mismatched, inactive, or
outside the Organization. Owner-level diagnostics are read on demand; they are
not automatically injected into model context. The
read must not adopt or mutate local-runtime identity. The Center Agent must use
the exact recommended mode and connected computer id when building the trusted
action. It must not infer update state from conversation text, substitute a
device id, treat current-computer diagnostics as Agent Profile readiness, or
expose another member's private computer context.

In that same requester-private conversation, an explicit member request may
use `openmeld_update_openmeld_tools` or
`openmeld_set_openmeld_tools_updates`. Both call the same owner-scoped Service
coordinator used by Web; neither tool accepts a device id, command, path, or
teammate target. `openmeld_list_computers` remains the canonical status read.
If the member asks to switch Codex or another supported local-agent
installation, the Center Agent first calls
`openmeld_list_local_agent_installations`, names the exact friendly choice, and
asks for confirmation. Only a later confirmed call to
`openmeld_select_local_agent_installation` may change the saved installation.
These controls are unavailable in shared conversations and Routines.

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
secrets, another person's highly private records and private Agent context, and
clearly non-public Organization financial, privileged legal, confidential
contract, Board, M&A, and active security-incident information. The agent
checks both replies and outbound tool arguments, refuses only the unsafe
portion, and should continue with a redacted, aggregated, or process-only
alternative when useful.

This guardrail does not change action authority. It must not block ordinary
reads, searches, calculations, or otherwise authorized actions merely because
the topic is finance, legal, HR, banking, or contracts, and it must not add a
confirmation step solely because information is protected. Public, synthetic,
clearly redacted, aggregate, and properly authorized private-context work
remains available. A manager, employer, administrator, Organization owner,
Space owner, or member is not automatically entitled to another person's
private Agent conversations, messages, memory, drafts, or assessments. A broad
standing instruction to answer every question or share anything is not
disclosure authorization. A clear current request from the person whose private
information is involved may authorize only the identified content and named
recipient or destination. When the destination is not appropriate, the Agent
does not confirm or deny whether that private content exists.

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
concept. Its surviving destinations use the stable header or its compact menu:

| Former tab | Target home                                          | Placement rule                                                                                                                                                              |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview   | **Center Agent → Center Agent settings**             | Identity, status, and configuration live in one low-frequency management surface.                                                                                           |
| Channels   | **App Settings → Center Agent → Channels**                          | The single Channel destination in every workspace; Organizations manage connections, while Personal Workspaces show read-only discovery and an Organization-creation guide. |
| Plugins       | **Plugins**                                             | The single member and shared App catalog in every workspace.                                                                                                                |
| Memory     | **App Settings → Center Agent → Memory** for member memory; **Settings → Center Agent settings** for Organization memory | Personal recall stays with the member-facing Memory surface. Organization policy stays with the other Organization-owned Center Agent settings. |
| Routines   | **Center Agent → Routines**                          | Routine use and creation remain daily product work inside the product that executes them.                                                                                   |
| Activity   | **Center Agent → Center Agent settings → Audit Log** | Retire the misleading label; this journal records Center Agent tool calls.                                                                                                  |
| Settings   | **Center Agent → Center Agent settings**             | One configuration home, with mutations role-gated.                                                                                                                          |

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
statistics and autonomous cross-Space work brokering remain deferred. The
read-only `openmeld_list_active_space_wakes` and
`openmeld_read_space_wake_progress` tools are the narrow coordination exception:
they let a verified represented member's Center Agent discover execution-backed
active work across the current Organization and inspect one authorized Space's
canonical Wake progress. The detailed read uses the same Core/Space projection
as Web and CLI, including public requester/message/thread context, rather than
reconstructing lifecycle state inside the model or Remote Agent. The list is a
bounded discovery snapshot; the model reads detail once for a concrete
coordination decision and does not poll. Neither tool exposes private runtime
context, mutates Space state, or grants execution authority.

Center
Agent Routines are the bounded recurring-work exception and follow their own
authority, target, scheduling, and native-delivery contract in
`developing/product/routines.md`; do not use them to widen the
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

The delegated Space message may also include Human Profiles as structured
Human Mentions and Agent Profiles as structured Reference context. The Center
Agent passes their exact Profile IDs in separate Mention and Reference fields,
apart from Wake and fallback targets. Core preserves both non-executable
relations in the Message Envelope and the durable publication command, but
never turns either into children, subscriptions, fallbacks, or continuation
conditions. Visible `@Name(mention)` or `@Name(reference)` text is not a
substitute for the corresponding structured fact.

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

If a Space continuation receives no worker ACK during its admission window,
Core retries that same Native Delivery at most twice after the initial attempt,
with 15-second and 30-second backoff. Every attempt reuses the frozen worker
request, delivery id, dispatch id, and idempotency key; it never creates a new
continuation or consumes the subscription again. A real worker ACK, including
an already-observed idempotent ACK, closes retry eligibility immediately.
After three unacknowledged attempts, Core publishes one explicit failure in the
original result thread and creates one urgent, action-required Inbox item for
the represented member linked to that result. The member does not need to poll
or remember to Wake the parent, and accepted or running work is never replayed
by this admission recovery.

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
  pausedByUserId,     -- audit actor; may become NULL after account deletion
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
- Current Organization owners and admins may pause or resume the Center Agent
  using their Human Profile and the `centerAgent.update` permission. Creation
  history does not grant lasting management authority.
- Pause is an Organization-wide emergency control. It requests cancellation
  of every current Center Agent native delivery across OpenMeld, Slack, and
  connected Message Channels, including Routine work, and rejects every new
  Center Agent admission while paused. Recovery and replay paths recheck the
  same operating state.
- Pause preserves the managed Agent Profile, designation, Direct Message and
  Space history, memberships, memory, Routines, Channels, Plugins, Bindings, and
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
permission. Pause/Resume uses the same current-role authority.

The hosted Binding is the single configuration owner. Its nullable `modelId`
has two meanings:

- absent means **OpenMeld default** and resolves the current repo-owned
  `center-agent.defaultModelId` when a new turn is admitted;
- present means the Organization selected that exact available catalog model.

The current OpenMeld default is **Claude Opus 5.5** at `medium` reasoning. Explicit choices come from
the shared hosted model catalog.
Changing the system default is intentionally scheme A: existing Organizations
on OpenMeld default use the new default for their next admitted turn, without
a migration or per-Organization rollout row.

Core resolves and freezes the complete model route exactly once at new-turn
admission. The accepted native-delivery request, its recovery request, and any
exact-task continuation in the same execution chain keep that route even if an
owner/admin changes the Organization preference or OpenMeld changes the
system default. A later independent human or Routine turn resolves the current
preference. This preserves in-progress work without making model selection
another execution authority.

GLM 5.3 Flash, Grok 4.6, and Grok 4.5 are provider-declared as text-and-image
models; DeepSeek V4 Flash is text-only. Regardless of the primary model's
capability, every current-version image first uses frozen GPT-6 Luna as the
auxiliary image-understanding model. The primary receives its bounded
untrusted description, not the raw image. An auxiliary or primary model
failure fails the turn; OpenMeld never switches the primary automatically.

Reasoning is part of the same frozen route. The hosted Binding stores an
optional effort alongside the selected model. Absent means that model's
catalog default; a present value must be supported by the selected model.
The Remote Agent Harness consumes the effective effort from the frozen route.
Web exposes the model and reasoning controls together. GLM 5.3 Flash does not
support `medium`, so its catalog default remains `high` when explicitly chosen.

The Center Agent system prompt receives the friendly effective model name so
it answers a member's question with that exact full name, without shortening or
renaming it from the model's internal knowledge. Web's Model setting reads the
Core projection and never infers the current model from profile directory
metadata or shows raw provider ids. BYOK is not part of this release.

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
- The Center Agent uses the same Core-owned Agent Profile Creation Request for
  the represented member and for another Organization member. A self request
  may complete immediately; a request for another member follows that target
  member's separate new-Session or existing-Session policy and may be rejected,
  approved automatically, or sent to Inbox for a decision. The represented
  member remains the requester and the designated Center Agent Profile remains
  the actor. Center Agent, Web, CLI, and Local Agents do not implement parallel
  creation, setup, approval, or preference-write paths.
- Before creating a local Agent Profile, the Center Agent reads the represented
  member's Core-owned Agent Profile creation defaults. The read returns the
  member's exact controller-specific Project, model, reasoning, permission,
  collaboration, and controller-specific permission choices. It never returns
  a local folder path and does not decide what configuration the task needs;
  the Center Agent remains responsible for that judgment. The Center Agent
  submits its final concrete selection through the same creation request. An
  optional Space is part of that request; omitting it creates no Space and adds
  no membership.
- The audited Organization Directory read is the shared People identity surface
  for Web, Center Agent, and local agents using the signed-in member's CLI
  authority. It includes current members, Human and Agent Profiles, roles, and
  optional Core-owned `lastActiveAt`; it does not grant profile mutation,
  Channel disconnection, private Computer access, or draft Profile Report
  access. The Center Agent may combine this directory with its separate
  team-safe Computer and approved Organization Document reads, but those owners
  remain separate and no composite cache becomes another source of truth.
- A narrow Center Agent member-list read reuses that same Auth-owned member
  projection for counting and paging through human members. It returns the
  authoritative total and never resolves Agent Profiles or readiness. The broad
  Organization Directory remains the only tool read for Agent Profile identity,
  ownership, and readiness; the narrow list is not a second People source.
- Space Files remain ordinary Space-owned collaboration. The Center Agent may
  list and read files in an Organization-owned Space when that same managed
  Agent Profile could read the Space, and may create, revise, organize, or
  trash files only while it is an active member with ordinary write access.
  Designation never bypasses Space membership. Its file tools use stable ids,
  immutable revisions, and the same base-revision conflict fence as Web and
  CLI. The same tools expose member-only Trash, bounded history, entry restore,
  and old-revision restore as a new latest revision; they do not copy files into
  Organization Documents or the Center Agent Computer. To send a file, the
  Center Agent first creates or updates the
  canonical Space File, then includes that exact file id and revision in its
  Space message. Receiving a file in a Space Wake provides the same canonical
  reference and tool guidance. Neither direction grants raw Durable Object or
  object-store access.
- Selecting or resetting the Organization working language is a represented
  owner/admin configuration action. The Center Agent does not receive
  autonomous authority to change it, and member research may write only the
  conditional `automatic` observation path described above.
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
  confirmation. An explicit interactive request can also authorize an exact
  delete or merge. Action-bound tokens may be consumed in the same turn; they
  bind inputs and identity, not human intent. Ask only when authority or the
  exact target/effect is missing or materially changes.
- Remove Project is a narrowly approved exception to the no-autonomous-
  destructive rule: it requires a short-lived Core confirmation token issued
  for the exact represented member, Project, and Project version, then consumed
  in the same interactive turn when already authorized. Project removal is unsupported during a
  Routine and returns `routine_destructive_action_unsupported` with zero side
  effects.
- Routine management is a narrowly-owned represented-member contract, not an
  autonomous privilege. A verified current member may ask the Center Agent to
  create, list, update, delete, pause, or resume a Routine; Core applies that
  member's exact owner/admin/member creator scope through the same Routine
  service used by human clients. See
  `developing/product/routines.md`.
- Every privileged Center Agent action lands in an audit journal from day one:
  actor (the Center Agent), org, action, on-behalf-of attribution. Under the
  MemberAgent program the attribution is the server-written request chain,
  whose first element is the human root requester; the chain replaces
  `onBehalfOf` (see `developing/architecture/agent-transport-contract.md`,
  Request Chain).
- Attribution: when the Center Agent acts on someone's ask (for example waking
  another member's agent), the visible action carries the Center Agent's
  display name plus "on behalf of X", where X is the chain's root requester.
  This is both UX honesty and the first prompt-injection mitigation.
- MemberAgent management operations: the Center Agent may set a member's
  Agent Profile default folder by folder id, archive that member's Sessions,
  handle access requests to that member's Agents, and change that member's
  Agent Profile permission mode. Implementation status: MemberAgent program,
  PR #236, shipped. Each operation checks that the request chain's root
  requester owns the target, and follows red line 8: the Center Agent acts
  only on the verified speaker's explicit instruction in the current turn,
  never autonomously. Archiving Sessions and changing permission mode are
  non-additive, so they also need a separate confirmation from the verified
  speaker after the instruction, bound by Core to the exact represented
  member, target, and input; the instruction alone never applies them.

### Permission-mode advisor

Implementation status: MemberAgent program, PR #236, shipped.

The advisor is prompt guidance only; it never changes settings. Core counts,
per Agent Profile over a seven-day window, permission questions raised by tasks
whose requester is not the owner. The count uses the one-hop
`requesterProfileId` until the request chain is enforced and the root requester
afterwards. At three or more such questions the Profile carries an advisory
flag. The flag is injected into the owner's next task prompt for that Profile
and into Center Agent guidance, so the Agent can say in context, for example:
"Tali used this Profile five times this week and each run waited for your
command approval; switch to acceptEdits?"

If the owner agrees, the Agent calls the existing permission-mode write; the
root-requester check restricts that write to the owner. The Agent suggests
only and never changes the mode silently, makes at most one suggestion per
Profile per week, and suggests the harness's next less-interrupting mode
(Claude Code: `acceptEdits` or `auto`; Codex: Approve for me), never
`bypassPermissions` by default. A new MemberAgent's welcome card carries one
line: the mode is "ask first", which suits personal use, and the Agent can
switch it later if colleagues use it.

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

Published OpenMeld product history follows this rule. Every supported Center
Agent surface uses the same read-only Core Changelog RPC over the GitHub-backed
machine projection. The Changelog is global public product history, not
Organization memory, a per-Channel cache, current setup evidence, or a roadmap.
The model reads it only when the user asks about changes or available releases;
OpenMeld does not inject the complete history into every turn.

Opportunity recommendations follow the same anti-drift rule. Every interactive
Center Agent surface uses the same three represented-member Core RPCs to
recommend, list, and decide Opportunities. The Center Agent may recommend at
most one evidence-backed Opportunity to the current verified speaker in a
turn; it cannot choose another recipient or broadcast. Core owns the durable
decision, Inbox is only a projection, and acceptance never becomes action
authority. There is no separate rule engine, moderation model, Channel sender,
or Organization-wide queue in Phase 1. Product meaning and future extension
boundaries are owned by `developing/product/opportunities.md`.

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

Space File tools follow the same anti-drift rule. Web, CLI, and the Center Agent
converge on the Space Durable Object file contract and the Core-owned byte
storage operation. The hosted runtime receives bounded UTF-8 text, not an R2
key or filesystem mount, and every mutation is attributed to the designated
Center Agent Profile under its ordinary Space membership. No runtime-specific
file tree, write-through cache, or privileged Computer path exists.

Scheduling is an execution mode for existing Center Agent capabilities, not a
separate agent or authority path. Core reauthorizes the Routine's delegated
member at Run admission. The default catalog-inheritance rule and its explicit
Agent Task continuation exception are owned by
`developing/product/routines.md` and
`developing/product/projects.md`; this Organization owner adds no second
catalog policy. Routine management tools remain available under the represented
member's authority, and no catalog decision bypasses capability-owned role,
connection, destructive-confirmation, audit, or fail-closed contracts. Durable
Routine instructions direct ordinary safe actions without a live per-Run
confirmation. They are not destructive grants; Routine delete and merge are
unsupported.

The built-in **Center Agent Self-Evolution** onboarding Routine is the bounded
continuous-learning composition of these existing capabilities. It is
recommended from connected Organization Plugins or Slack, can focus on one
Project, maintains explicitly granted approved Organization Documents, and
publishes its complete result to an OpenMeld Space. An owner or admin may also
enable one concise Slack team report. That report is the only optional external
write: it requires the Routine's explicit structured Slack-report grant, while
all other App, GitHub, and Message Channel writes remain blocked by the stored
read-only policy. Its selected-source list is instruction scope, not additional
connection authority. It cannot create or modify other Routines in the current
slice. Full product semantics are owned by
`developing/product/routines.md`.

### Channels and Plugins

Center Agent integrations have two distinct user-facing families. Do not place
both under a generic `Connections` label:

- **Channels** are places where people or systems can message the Center Agent
  and receive replies. Slack is the first shipped Channel. Lark and Feishu setup
  is enabled in local and production configuration for every Organization but
  remains `configuring` until
  Core verifies both the Event Subscription URL and Message Card Request URL
  for that connection. Setup availability does not prove live provider delivery.
  Email, WhatsApp, other
  collaboration platforms, and API delivery may join this family later. A
  Message Channel owns conversation routing, sender
  identity mapping, and the result surface. A Channel may also expose a
  narrowly defined outbound messaging action, such as explicitly publishing a
  top-level message in a Slack channel. That action does not grant model access
  to the provider's wider data or management APIs.
- **Plugins** are external systems authorized Agents may read from or act in while
  doing work. GitHub is the first shipped App through OpenConnector. An App owns
  a scoped credential, action policy, and attribution. It is not a conversation
  result surface merely because the same provider also offers messaging.

One Organization may connect Slack, Lark, and Feishu at the same time, with at
most one active connection per provider. These connections all address the
same designated Center Agent Profile and hosted Binding; they do not create
provider-specific Center Agents. Connecting, repairing, moving, or
disconnecting one provider does not mutate another provider's connection.

Slack, Lark, and Feishu also appear as Plugins in the live OpenConnector
catalog. Their user-account authorization is separate from Channel bot setup.
Gateway reads that catalog with the runtime token and uses the administration
token only for connection management. The catalog's `authTypes` declares OAuth
support; `connectionAuth.oauth` reports whether this environment's OAuth client
is configured. A missing client keeps the Plugin discoverable but disables
sign-in and explains the operator setup requirement. It never implies that a
Channel connection grants Plugin access.

Plugin connection ownership is a product policy, separate from OAuth support
and Agent access. Gmail, Outlook mail and calendar, Google Calendar, Google Meet,
and Zoom are
personal-only: connect them under Personal and explicitly authorize each Agent.
A company email address does not make an individual's mailbox a shared
Organization account. Other providers currently support both Personal and
Organization connections; none requires an Organization-only connection.
The shared policy in `packages/schemas` controls scoped catalog browsing, setup,
connection selection, named execution, and access grants. An existing shared
personal-only connection remains available for owner disconnect, but cannot
be selected or executed and cannot receive new grants. Do not convert its
ownership or delete its credentials automatically.
Catalog search may discover personal-only Plugins from the Organization tab,
but must label them Personal and route to personal setup. Discovery does not
grant shared ownership or Agent access.

Providers can declare a `custom_credential` connection with no fields, such as
the public Cloudflare Docs MCP server. Gateway accepts an empty values object
for this authentication type; OpenConnector validates it against the provider's
declared fields. The connection still requires OpenMeld ownership and explicit
Agent access grants. API-key connections still require a non-empty values object.

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
Organization. Creating that Organization does not move Spaces, Plugins, Agent
Profiles, memory, or any other Personal Workspace data.

Every accepted Message Channel turn freezes one typed originating-conversation
locator in Core before worker admission. Progress, final replies, and explicit
visible failures return only through that locator. Provider callbacks, model
output, a conversation-id prefix, or a second connected provider cannot
redirect the normal result. Current provider transcripts also remain separate:
using the same Center Agent does not automatically copy Slack, Lark, or Feishu
history into another provider conversation.

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
public Web and bounded public-browser research, and Organization-shared Plugins.
GitHub work explicitly selects `githubActor = organization` and executes through
the Organization's GitHub App installation as the OpenMeld bot; it never borrows
the requester's GitHub identity. Ordinary non-GitHub Plugins resolve only an active
shared connection for an unlinked member and never fall back to another
member's connection.

App reads run directly. For non-GitHub shared Plugins, the action owner's
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
receives no creator-specific management authority. The historical Agent
Activity tool returns the public bounded snapshot. The Session Inventory tool
returns the same paginated public Session contract used by Web and CLI,
including provider-native Session ids but excluding paths, prompts,
transcripts, internal runtime identity, and private provider metadata. Project
mutations and member-owned Activity or local context remain identity-gated;
seeing a Session id never grants Resume, Fork, Binding, or Space authority.

Personal memory, member Plugins, owner-level Local Agent or Computer details,
role-restricted actions, destructive confirmation, durable member-owned
mutations, and any action whose owner requires one specific OpenMeld human
remain unavailable until identity is linked. The strict team-safe Organization
Computer projection remains available as an ordinary shared read and never
upgrades into owner diagnostics. The Center Agent completes every independent
safe part first, names only the concrete blocked action, and attaches the
one-time setup action. It does not stop at an account-status explanation, tell
the person to find an administrator, expose a reusable Organization join link,
or ask them to repeat the request. A verified link never upgrades the already
admitted unlinked turn; Core creates one new deterministic linked-member turn
for the original request after setup succeeds.

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

That link is a replaceable relationship, not an irreversible merge. One
provider account maps to at most one OpenMeld member at a time, while one member
may connect independent Slack, Lark, and Feishu accounts. If a provider account
is linked to the wrong member, the person proves control from that exact
provider-private account and confirms while signed in to the intended OpenMeld
account; Core atomically moves the canonical link instead of creating a second
mapping. The linked member may disconnect their own link, and an Organization
owner or admin with Channel-disconnect authority may detach a wrong link from
People. An administrator cannot assign a provider identity to a member without
fresh provider-private proof. Detaching an account never disconnects the
Organization's Channel connection, changes membership, or deletes provider
history.

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
Core reports that their Computer is not connected, is offline, or needs an
update, the Computer query returns those facts and the Center Agent explicitly
requests the exact Core-projected navigation action as the one next step needed
to continue that task. Core publishes that action privately to the same Slack,
Lark, or Feishu identity only after the ordinary task result is confirmed. The
public channel receives the useful result and concrete limitation; the
requester receives the native **Connect computer**, **Reconnect computer**, or
**Update** action. A normal answer, diagnostic
read, or unrelated task never receives setup guidance merely because a Computer
query ran or returned a recommendation.

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
Center Agent again. The completed Web handoff also offers **Open Slack thread**
using the permalink resolved by Core from that exact source delivery, so the
person can return directly to the continuing conversation. Permalink lookup is
navigation only: failure is observable but never rolls back the completed
identity link or the continuation attempt. During a mixed-version rollout, an
action already delivered
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
private Organization context, sandbox, connected Plugins, or Local Agents. Slack
guests (`is_restricted` or `is_ultra_restricted`) and Slack Connect external
participants (`is_stranger`) are also excluded from Slack self-enrollment.
Current Slack participant status is checked before any stored identity link may
represent the sender, so an existing OpenMeld membership or matching email
never bypasses that provider boundary. New requests require a current identity
link; email equality may support a private matching suggestion but never
creates the link or grants represented-member authority. They receive one concrete next action: use a full
member account from the connected Slack workspace. The current product has no
access-request or administrator-notification workflow, so the Center Agent must
never claim that it sent one.

Lark and Feishu share one internal Lark-platform implementation, but remain
distinct provider identities because their domains, consoles, tenant
governance, identifier namespaces, and deployment conditions differ. The
Personal Agent Channel grant authorizes only the implemented bot conversation
surface. It never creates a member user grant for Docs, Calendar, Mail, Tasks,
or other business actions. Any future Feishu/Lark App belongs to the separate
Plugins and OpenConnector-or-reviewed-first-party action boundary; its
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
profile, and target connection by a single-use ten-minute opaque state. For a
new installation, GitHub returns the installation id to OpenMeld's public setup
callback. For an App already installed, OpenMeld starts user authorization
directly and accepts the installation only when that user can access exactly
one organization installation of the configured App. If several installations
are accessible, setup must stop instead of guessing an account. Both paths use
a temporary verifier connection before OpenConnector stores the final
installation credential. Core stores the installation id and connection
ownership metadata, never an installation token, App private key, OAuth client
secret, or user token.

A normal OpenMeld disconnect removes only the current Organization's registered
connection and matching OpenConnector credential. It does not sign the browser
out of GitHub or uninstall the OpenMeld GitHub App; installation repository
access remains managed in GitHub Settings → Applications → Installed GitHub
Plugins.

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
endpoints available to public OAuth Plugins. The public scope set therefore
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
vendor term; the product category is `Plugins`.

Do not show a planned Slack App merely because the Slack Channel exists. The
Channel is presented as Slack in **App Settings → Center Agent → Channels**. A separate Slack
entry appears in **Plugins** only when OpenMeld ships a distinct
OpenConnector-backed Slack data/action connection and its model-visible tool
surface.

The Slack Channel installation requests a reserved scope bundle, but OAuth
possession is not OpenMeld execution authority. Only implemented, model-visible
tools with Core authorization may use those scopes. The shipped read-only
workspace-directory action uses `users:read` and `users:read.email` to fetch one
bounded live page of active human Slack members. Core first resolves an exact
Organization- and workspace-scoped Slack identity link to a current OpenMeld
Organization member. Without a link, an exact normalized email may classify
the directory row as a likely current member for this read only. That hint does
not create an identity link, represent the Slack sender, or authorize a
member-owned action. A different available email means not a current member for
that directory response and a missing email remains unknown. Names, titles, and
other Slack profile fields are untrusted evidence and never establish identity.
The action is audited after a successful read and does not persist a Slack
roster, invite anyone, or contact anyone. When a verified member explicitly
asks to notify a directory result on Slack, the model may use that result's
exact Slack user ID for a real
`<@USER_ID>` mention. For explicit channel publication, the posting tool accepts
those IDs through a structured field, verifies that the same turn's directory
read returned them, and constructs the mention tokens outside model-authored
text. It rejects display-name mentions and guessed IDs.

People may show the exact Slack account display name and email for an existing
Message Channel Identity Link. Core resolves that optional display metadata
from the currently connected Organization Slack workspace and the exact linked
Slack user ID; Web presents distinct values together when both exist and never
treats a provider display name or identifier as an email. This read does not
create or change the identity link, and an existing connection does not need to
be disconnected or reconnected merely to populate the metadata. If Slack does
not return either value, the projection remains explicitly unavailable rather
than guessing.

Core records the exact bot scopes returned by Slack for every OAuth installation.
`im:history`, `im:read`, and `im:write` are all required before Web presents
Slack direct messages as ready. `im:read` lets Core ask Slack for the
conversation facts that prove an App Home message is requester-private. A
DM-originating private invitation fails closed without that proof; a
shared-channel request instead requires its own active Core-authored Slack
delivery evidence. Older installations without recorded grants remain
connected for their existing capabilities but show
**Reconnect required** with one OAuth action for an owner or admin. Reconnecting
refreshes the same workspace installation and does not ask the user to
disconnect it first.

During rollout, an older Gateway may omit the grant list and the new Core
records that installation as capability-unknown instead of rejecting it. Core
must deploy before the Gateway starts sending the new field, and Web must
deploy after Core before presenting the readiness result.

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
ledger. Gateway acknowledges every valid welcome button interaction, including
a URL button, within Slack's three-second deadline before waiting for Core.
For either native picker, Core uses the single-use trigger only to open a
generic, input-free checking modal within a shorter bounded budget while it
rechecks the linked member. No Organization data, join link, selection control,
or submission action appears before that check succeeds. Core then replaces the
same modal through Slack's returned view id and hash with either the authorized
picker or one private next step; closing the checking modal is a normal outcome.
The same private-invitation action is available in any current Slack
conversation initiated by a verified OpenMeld Organization member. The Center
Agent reads the live workspace directory, resolves only exact named people,
and sends their returned Slack user ids through the same Core interaction and
delivery contract. An ambiguous or missing name produces one short
clarification; the model never guesses an id. Core binds execution to the exact
active Slack delivery, workspace, requester identity, and Organization member.
A shared-channel request authorizes only the named target DMs; it does not
authorize a channel post, widen the audience, or expose the Organization join
link to that conversation. Every welcome button, conversational invitation,
and modal submission rechecks the linked person's current Auth-owned
Organization membership before it exposes a join link or performs an action;
a removed member cannot keep using an old Slack identity link. A current member
may explicitly share an existing active Organization join link through the
separate link action; only an owner or admin may create that link when none
exists. A named-target private invitation never converts a failed target DM
into an unrequested channel post. If a member asks to invite teammates before
an owner or admin has created a link, the modal submission closes and the
Center Agent immediately sends that member one private next step instead of
failing silently in background work. It never posts those private invitations
to a channel. When Slack does not expose a selected teammate's email, Core does
not send a targeted invitation that it cannot safely correlate after joining.
In a private conversation, the Center Agent returns the same join link for
manual sharing as the lowest-cost safe next step. In a shared conversation,
Remote Agent removes that link from the model-visible result and asks the
requester to continue in a private Slack conversation. Before claiming any
private invitation, Core
also compares the selected Slack email with the current Auth-owned Organization
directory using exact normalized email. Someone who is already a member is
skipped, receives no redundant join message or onboarding, and the requester
gets one short no-action confirmation.

Conversational invitations preserve the one-answer-owner contract. Core sends
the target DMs and returns strict per-target outcomes such as `delivered`,
`already_member`, `manual_invite_required`, `failed`, or `outcome_unknown` to
the same Center Agent turn. Core does not separately message the requester;
the Center Agent interprets those outcomes in its one final reply. A native
modal submission still receives one Core-authored requester summary because no
Agent turn owns that modal interaction.

In an ordinary verified Slack conversation, the same Center Agent turn may use
Slack Real-time Search as a bounded evidence tool, including for a question
such as "what have you learned about how I work?" Public search does not require
the App to join those channels. Search never becomes a separate answering
Agent: the Center Agent evaluates the returned messages with the request and
conversation history, continues any requested OpenMeld action, separates
verified observations from gaps, and links useful claims back to Slack. Search
evidence remains current-conversation context and is not automatically promoted
to a Profile Report, Memory, Organization Document, or Computer file. Durable
knowledge still uses the separately governed owning flow.

A channel
introduction starts in direct message: a native picker accepts at most five
public channels, Core joins those channels when needed, and the Center Agent
reads one bounded recent page before posting a short introduction grounded in
the channel's actual work. Core freezes the selected channels as one immutable
durable manifest before the acknowledgement is published, then submits one
idempotent native delivery per channel and checkpoints each item separately.
The acknowledgement and each private teammate invitation carry stable Slack
message metadata. A confirmed Slack message followed by a failed PostgreSQL checkpoint
stays recoverable rather than becoming a false terminal failure: Core first
retries the checkpoint, then scheduled work reconciles the exact Slack message
before continuing onboarding or channel publication. Recovery never blindly
duplicates a provider-ambiguous message. If the original channel acknowledgement
cannot be confirmed, the one private retry action is also durably claimed,
checkpointed, and reconciled instead of being sent as an untracked follow-up.
If native delivery was durably accepted but the per-channel item checkpoint
fails, the item remains submitting; the scheduler reclaims it after the bounded
lease and the same native-delivery idempotency key recovers acceptance without
submitting the Center Agent turn or publishing a failure notice twice.
The minute scheduler reclaims only an interrupted item; a completed channel is
never silently repeated and a process restart cannot make a later selected
channel disappear. Core includes an existing active Organization join
link for any verified member; an owner or admin may also create the missing
link. A member without link-creation authority can still complete the
introduction without a link. The Center Agent does not rank people, disclose
private observations, or mention an individual unless the requester explicitly
asked it to notify that person.

Member research or report-file failure never makes the first Slack experience
silently disappear. Core uses the existing durable welcome publication claim
to send one brief, honest message that the first Profile Report could not be
finished and offers the lowest-cost next action: reply “try again” in the same
DM. Missing or invalid Web URL configuration fails before publication rather
than stripping the promised welcome actions. Any failed welcome button or
modal action likewise produces one private retry/reconnect next step when Core
can still reach the Slack workspace.

Each Slack onboarding research acceptance has one stable internal idempotency
key stored on the Core research batch. If research is accepted but the welcome
preparation or invited-member row cannot yet store the task id, that onboarding
remains recoverable. A later scheduler tick resolves the exact same batch and
task, even after research has finished, instead of opening a duplicate report
or sending a false research-failure welcome.

An invited Slack user receives the Organization join link and a simple account
of what will happen after joining; OpenMeld does not claim to know that person
before Organization membership exists. After the joined Organization member
uses the universal provider-private proof flow to connect that exact Slack
identity to an active Human Profile, Core atomically claims at most one
onboarding across all delivered invitations for that Organization, workspace,
and Slack user, runs member research for the new member, writes the Profile
Report to the Center Agent Computer, and sends a second private welcome with one
evidence-backed observation or an honest insufficient-context state. Matching
email remains comparison context and never starts onboarding or writes the
identity link. Duplicate invitations are closed without starting another
research task or sending another welcome.
The second welcome has its own durable publication claim. A confirmed Slack
rejection may retry, a confirmed delivery is recovered by its recorded message
id, and a lost or ambiguous outcome never triggers a blind second message.
That claim may omit a research-task id only when research could not start; the
same ledger then owns the one honest failure-aware welcome instead of storing a
made-up task.
The new member may then reply in Slack, invite more teammates, or start the
channel-introduction flow. A move starts a new Organization context with
different members, Spaces, Plugins, and agent state, so reusing the previous
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

Plugins is a primary workspace capability shared by Center Agent, Local Agents,
and personal Remote Agents. A connection's owner sets `none`, `read`, or `write`
access separately for those three consumers. Organization owners/admins manage
shared access; only the connection owner manages personal access. Administration
of a personal registration does not grant use of its credentials. Connections
remain scoped to one Organization; personal ownership does not imply cross-Org
credential reuse.

The runtime provider catalog owns service identity and available authentication
methods. OpenMeld accepts provider service keys through one shared contract,
renders every supported credential method, and preserves multiline field types.
Featured catalog entries are presentation metadata, not an execution allowlist.
The Plugins browser shows featured entries only when the current runtime reports
a configured OAuth client or a supported credential path. Loading and failed
catalog reads must not fall back to advertising static entries as connectable.
Existing connections remain discoverable for management even when their provider
is no longer featured or ready for new connections. The full upstream directory
remains available to explicit provider lookup; it is not the default product
catalog and does not establish a public support count.
Catalog-only providers without an executable connection method cannot be
connected. Agent discovery lists only active shared connections and the verified
requester's personal connections, then applies the existing execution policy.

New personal and shared registrations persist explicit `none` for every Agent
consumer before provider authorization. Provider consent/activation is not an
Agent grant. The connection owner must explicitly save Agent permissions through
the existing revisioned, audited access editor. The same editor follows the
connection form in Plugins, Onboarding and conversation setup.

Historical registrations with an absent policy retain their shipped Center and
shared personal-Remote access; Local access and personal-Remote access to a member
connection remain disabled. New inserts must not reuse this legacy null-policy
compatibility rule. Reauthorization of the same Organization/scope/owner/service
registration preserves its existing policy but advances its access revision so
an earlier permission draft cannot overwrite the new authorization. Access may
only be saved while the connection is active, fenced in the same audit/write
transaction. Access revisions are monotonic fences, not a count of grant events.
A different member or Organization has a different registration and starts with
no access. Shared setup attribution may change between authorized administrators;
the Organization remains the credential-policy owner, not the last installer.
These connection-level grants do not attest a provider account identity beyond
what the existing connector verification proves. Moving navigation alone never
expands existing authority.
Read-only access requires trusted action metadata declaring a read. Unknown and
destructive effects require write permission and exact-action confirmation.
Personal Remote Agents may use their owner's connection only for a verified
request by that owner (including the owner's delegated Routine). Another member
waking the Agent cannot borrow that private connection. Center continues to use
the represented member's personal connection under its existing request policy.

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
**Plugins** page and neither label changes the underlying ownership or
execution authority.

Management location follows the owner instead of repeating mutation controls:

- In every workspace, **App Settings → Center Agent → Channels** is the single Channel
  destination. It owns Channel management in an Organization and shows only
  Organization-creation guidance in a Personal Workspace. **Center Agent →
  Plugins** is the single catalog and
  management surface for both the current member's connections and
  Organization-shared connections.
- The first-entry Organization flow may offer one-time, role-appropriate
  Slack Channel and GitHub App connection actions. It keeps Channels and Plugins
  visibly separate, has no disconnect
  or repair controls, and accepts success only from the owning Core projection.
  Center Agent remains the ongoing management home.
- The Center Agent Chat page does not duplicate Channels or Plugins settings.
  A Plugin connection message may open the same authorized connection and access
  surface in a compact dialog; it does not implement separate management logic
  or permissions. Other status shortcuts use the canonical management page.
- When the Center Agent tells a user to complete or repair App access, it uses a
  structured Navigation Action for the current Organization's canonical App
  page. The reply gives the outcome, one concrete next step, and that direct
  link; it does not ask the user to find the Organization selector or reconstruct
  the Center Agent path themselves.
- All Organization members may view Channel and shared App status. Only owners
  and admins may mutate Organization-owned access; members may manage their own
  member app connections. An ordinary member may request that owners and admins
  set up one available Message Channel provider. Core creates one deduplicated
  Organization Inbox request per requester and provider; it grants no setup
  authority, links recipients to **App Settings → Center Agent → Channels**, and resolves the
  request after that provider becomes connected.
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
that same verified member. For ordinary non-GitHub Plugins, an unattended Routine
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
pull-request merge use an exact action preview and token, which may be consumed
in the same turn when the verified user already authorized the concrete action,
repository, and chosen identity. Otherwise the Agent asks before execution.
Routine file deletion and
pull-request merge return `routine_destructive_action_unsupported` with zero
side effects. A member connection may be disconnected only by its member owner
or an Organization owner or admin.

#### Shared app connections (shipped)

Each Organization may have at most one shared connection per supported App.
The connection records `scope = shared` plus the owner/admin who authorized the
provider setup. Linked OpenMeld members and connected Message Channel members
may ask the Center Agent to use it, and unattended Routines may use it because
no member-owned credential is borrowed. For a linked interactive member,
ordinary non-GitHub Plugins retain requester-first, shared-second selection. For
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
  requester-private Center Agent turns may build that member memory for the
  verified requesting member, whether the private conversation is an OpenMeld
  DM, Slack DM, Lark DM, or Feishu DM. The member can wipe it without deleting
  messages, Spaces, or shared organization memory.
- **Organization memory** is on by default for recall and explicit saves.
  Completed turns in shared Spaces and Organization-shared Channels do not
  automatically write any memory scope. Requester-private conversations retain
  automatic Member capture; externally shared conversations capture neither.
  The Center Agent may save an
  explicit Organization fact only from an `organization_shared` conversation
  while Organization memory is enabled. Remote Agent offers that explicit tool
  only when the frozen environment is present, non-conflicting, and
  `organization_shared`. Core still owns the decision and rejects a call from a
  requester-private or externally shared environment even when an old or
  compromised worker attempts it.
- For automatic completed-turn capture, Core selects the memory subject from
  the frozen `interactionEnvironment` and a currently verified requester/member
  identity. `requester_private` selects Member memory,
  `organization_shared` and `externally_shared` select neither. A carrier or provenance source such as
  `slack_conversation` or `message_channel_conversation` never selects the
  subject. Missing, conflicting, or mismatched environment and identity
  evidence fails closed without a memory write. Automatic capture runs after
  the reply and is not a model-callable tool, so the Center Agent must not infer
  success, failure, or carrier support from the visible tool catalog.
- Recalled memory keeps the source surface and occurrence time of the episode
  that produced it. Entering through a different DM, Space, Slack, Lark, or
  Feishu conversation must not relabel the memory as if it came from the
  current conversation.
  Its model-facing provenance is historical and not reopened for the current
  turn; explicit saving does not make a recollection an adopted rule. Current
  Guide reads and published document references remain separate evidence.
- Automatic recall reads existing active subjects without provisioning or
  reviving deleted memory, then rechecks policy and subject state after the
  provider returns. Selection preserves rank within each scope and shares both
  the six-item and 1,600-character budgets. Provider fact validity is a bounded
  text hint, with unknown times marked explicitly; occurrence time is not an
  approval time. Current approved documents take precedence over old memory
  for current work, while historical questions may still use historical facts.
- A personal preference expressed in a shared conversation is not silently
  saved to either scope. Acknowledge understanding without claiming durable
  storage or suggesting team sharing as the default. Explicit personal writes
  in shared conversations are outside this phase.
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
- When an artifact attributed to that verified member is absent from the
  current conversation, the Center Agent checks its bounded audit provenance
  and source conversation before characterizing the authorization. A missing
  match is reported only as a missing matching authorization, never as proof
  that the member did not request the work. This lookup may establish
  continuity, but it does not combine source transcripts into the current
  conversation.
- An explicit save records `explicit_save` as the capture method while keeping
  the verified conversation surface as its source. The save mechanism must not
  replace a Space, Slack, Lark, or Feishu origin with `explicit_tool`, and it
  must consume the same non-conflicting frozen `interactionEnvironment` as an
  automatic write before Core admits the Organization subject.

Core owns scope, authorization, enabled state, subject identity, and deletion
lifecycle. `developing/architecture/data-and-observability.md` owns storage and
provider boundaries; `developing/product/remote-agent-runtime.md` owns recall
and turn-envelope behavior. In a multi-member Organization, **App Settings → Center Agent → Memory** owns the current member-memory wipe entry, while **Settings → Center
Agent settings** owns ongoing Organization policy management. A Personal
Workspace keeps both Workspace memory and member memory on **App Settings → Center Agent → Memory** because there is no separate Organization administration boundary.
**Settings → Personal → Privacy** links to the member-facing Memory page instead
of owning a second mutation surface. Setup Studio presents the Core-owned
default as enabled without manufacturing a user choice. It does not own another
policy or ongoing management surface.

### Explicit retained-memory search and bounded audit reads

Organization memory's enabled setting is distinct from service availability.
Settings show the latest bounded recall check, including unavailable or not yet
checked states. The setting remains editable when the provider cannot be read.
Explicit saves distinguish provider acceptance (`processing`) from completed
processing. Neither state alone proves that a later conversation can recall the
fact. On an uncertain save, the Center Agent searches before repeating a write.

`openmeld_search_center_agent_memory` is a query-driven read over existing
active member memory and enabled Organization memory, not universal conversation
search. Core accepts a verified interactive member in an OpenMeld DM or Space;
Routine and external-channel callers are not supported by this reader. The
query is trimmed and limited to 400 characters; at most six remembered summaries
are returned. Reads never create/revive subjects, enable policy, capture another
conversation, or change automatic recall.

Every returned fact retains all of its bounded supporting origins. Core checks
current member authority, current reply audience, source Space access, and the
exact source message through the owning Space APIs. A fact with any inaccessible,
missing, revoked, unverifiable, or audience-unsafe support is withheld as a whole,
without hidden-source identifiers or omitted-result counts. A previously private
DM converted into a shared conversation does not retain private disclosure
rights. The currently supported provenance is retained `ca_dm` and
`space_conversation` evidence; Slack, Lark/Feishu, and legacy `explicit_tool`
origins without a verified conversation source remain explicitly unsupported by
this reader, independently of existing capture support.

Results are remembered summaries, not quotes or proof of current approval.
`no_match` is not proof that a conversation never happened. Provider failure
produces `partial` or `unavailable`, rather than an empty successful recall.
Source occurrence times remain available for checking reversals; verify current
decisions against readable original sources and current Organization Document
revisions. Historical source instructions confer no new action authority.

`openmeld_read_center_agent_activity` reads the existing Audit Log through a
private member-attributed adapter, not the human membership endpoint. Core keeps
the designated Agent principal and separately verifies the represented member;
a Routine uses its current delegated member, not a substituted Organization
owner. The human journal and its action-set compatibility remain unchanged.
The bounded Agent projection omits context-manifest details and exposes only
currently readable, audience-safe Space references. Other resource references
are withheld; absence does not prove that an action or authorization never
existed. Audit evidence does not create execution, replay, or repair authority.

### Organization Documents

Current document reads carry a content-versioned source reference. Automatic
Brief context can opt into the same reference while preserving legacy response
shapes. Pending drafts never supply the current Brief, including its source
identity. Guide snapshots identify their admitted content version; the Center
Agent can reread the owning Space's current Guide after compaction or a later
correction. An empty Guide is evidence of empty current content, while a failed
or revoked read is unavailable evidence. Source references locate context and
do not grant permissions or establish who personally approved a rule.

Documents are organization-scoped Markdown context. Every document body
persists as plain CommonMark + GFM text so humans, the Center Agent, and
local agents all read the same clean Markdown; the Web editor must not
introduce storage syntax outside that contract. It has three document kinds:

Space Files do not change this product or appear here as a projection. They are
owned by their Space and remain available from that Space's Files surface. A
future explicit copy may create a new Organization-owned resource, but it is a
new identity with provenance rather than synchronization or shared storage.

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

Task preparation gives Center, personal Remote, and Local Agents a bounded
directory of approved non-empty documents with IDs and `updatedAt` versions.
Bodies remain on demand. An owned active Local Agent reads through the ordinary
member API in the Space's Organization; the Agent projection contains no draft
body or edit/manage permissions. The personal Remote Agent uses the existing
read RPC as the receiving Agent, including Wakes sent by another Agent. Core
verifies the active delivery, current owned Profile and membership, and frozen
task audience; it does not borrow the sender's human or writing authority.
Center requests still require the existing verified speaker. The personal
Remote Agent's Center-only protected prompt and Computer projection remain
disabled: ordinary document access does not confer Center
identity, protected information, or a writable document checkout.

The display uses a 6,000-character starting budget, counts only authorized
entries, and includes a full-list/read entry for omitted documents and Skills.
Relevant rules must be read before being applied. Current Center prompt reads
do not share an Organization-only cache or fall back to earlier bodies after
denial or transport failure. A failed directory read is marked unavailable;
ordinary conversation can continue, while work depending on unread rules must
report the missing context. No index is stored in Core, global Skill directories,
or repository `AGENTS.md` files.

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
editable Document surface without a separate approval, correction, or discard
control. While that version is provisional, the surface explains that it needs
to be reviewed and saved, and the existing **Save changes** action remains
available even when the human makes no text edit. Saving accepts the visible
version as current Document content, clears its internal provisional fields,
and resolves its Inbox attention item; the person can also simply tell the
Center Agent when something feels off. Welcome preparation reads the current
visible report body, whether it is still provisional or was already saved, so
a fast human save cannot stall onboarding. When several reports share a date,
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
Document identity. Remote Agent reads the exact Core-owned approved snapshot
into turn-local memory when the frozen context plan allows Organization
Documents. It does not automatically export the snapshot onto shared disk;
only explicit checkout creates a working copy in the current conversation's
directory. This prevents one session's document preparation from deleting
another's inputs. The old reserved automatic projection is retired before
Computer tools become available. A plan excluding Documents does not fetch
the snapshot or expose checkout/submit tools. Explicit working copies remain
ordinary files on the shared Computer; session directories are not privacy
sandboxes. Identity and base-version checks use the trusted snapshot, never a
manifest or sidecar inside the Agent-writable filesystem.

Only the approved, non-empty Organization Brief is placed into the Center Agent
system prompt. The full body is explicitly organization-maintained data and
cannot override OpenMeld system or tool safety rules. Other approved documents
with non-empty approved content are discoverable by title and readable through
the audited document tool; their bodies are never injected wholesale. A
draft-only document does not place its proposed title into the system prompt.

People represents every current human member with one **Human Profile** item in
a dedicated secondary sidebar, including an explicit missing-profile state when
that member has no Human Profile identity yet. Selecting an item makes that
person's complete Profile detail the persistent main content; it does not open
a transient drawer. The item owns only high-frequency scan signals: a prominent
Human Profile avatar, the member's name, an explicit `(you)` marker, Core-owned
relative last-seen time, coarse Computer state, one compact mapped Slack, Lark, or
Feishu identity line, and enabled reported Local Agent icons. The mapped
identity line may show the provider icon followed by the account name or handle
and provider email when Core supplies those values. The member's OpenMeld
account email and Organization role belong in Profile detail, not in the
sidebar. Missing identity mappings, unavailable account metadata, unconfigured
providers, and disabled Local Agents add no placeholder text, empty row, or
icons. The relative time is compact body copy such as **3 hours ago**; its
tooltip supplies the full meaning, such as **Last seen 3 hours ago**. It shares
one row with Local Agent icons, aligned at opposite ends. Every logo-only signal
has an accessible name and tooltip and reuses the catalog-owned
identity from its canonical Channel or Computer surface.

The sidebar never exposes the internal profile Handle or slug, a generic
**Active** badge, an invented online presence, or an undefined recent-activity
field. It groups members who have at least one registered Computer under
**Connected** and members with no Computer under **Not Connected**. The labels
explain **Computer connected** and **Computer not connected** in tooltips. The
signed-in member's group appears first and the signed-in member remains first
inside it. Everyone else sorts by most recent last-seen time within their group;
members without activity sort last, followed by name and user ID as deterministic
tie breakers. People must not duplicate the same people in a separate Members
card. **Learn about all
members** belongs to the People sidebar. **Invite Members** opens one dialog
that contains both the email-and-role invitation form and the invite-link Copy,
Reset, and Revoke actions; invitation controls do not occupy the main detail.

Opening the authenticated Organization Web app, returning it to the foreground,
or continuing to keep it visible reports explicit Web activity at a bounded
cadence. Core verifies the active member and current Human Profile and advances
the same Organization-scoped activity projection used by accepted Human Space
messages. CLI use does not report this Web activity. This is last-seen evidence,
not a claim that the person is currently online.

An existing Profile Report opens from a top-right document icon. Amber means
the report has updates to review and save. **Learn about {member}** remains
available beside it to create a fresh dated report. When the current Documents
projection proves that no report exists, People shows only **Learn about
{member}**; it never opens a blank document. While Documents are loading or
unavailable, People shows neither action because it cannot prove the current
report state. A
single-member learning start failure stays on that member's detail with its retry
action. **Learn about** asks the designated Center Agent to process one member
at a time and create one new dated Profile Report. The all-members operation is
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

The persistent Profile detail owns contextual **Profile Report**, **Learn about
{member}**, **Direct Message** for another active Human Profile, and inline
**Edit profile** actions. It also owns member account details, Organization
role, join time, ordinary Agent Profile count and icons, Computers, **Connected
Channels**, and shared Profile details. Its Agent Profile count links to Agents
and focuses the first Agent Profile in that member's owner group. Edit remains
available only for the signed-in member's own active default Human Profile. Self-Direct Messages
are unavailable, and owners or admins do not receive an edit action for another
member's Human Profile. Editing the current member's default Human Profile
reuses the paired Account Display Name mutation rather than introducing a
second identity writer.

In an Organization workspace, each Human Profile sidebar item also shows one coarse
**Computer** summary. One online Computer is **Computer connected**; two or more
online Computers show the connected count; a mixed set summarizes only the
online count; and an all-offline set is **Computer offline** without a count.
Attention and unavailable states remain explicit. The sidebar colors the Computer
icon green for connected, amber for attention, and muted otherwise, with no separate status dot. A member
with one or more Computers sees the same coarse summary while the main detail
renders one existing Computer card per device. Selecting a Computer card opens
that exact Computer detail. A signed-in member with none sees **Add a Computer**
and reaches the normal setup path, while another member sees only **No computer
connected**. The Add card remains available alongside existing Computers only
for the signed-in member. This answers only whether at least one current OpenMeld Service
session for the member can carry Wake work; it does not claim that the member
is online or that any Agent Profile is ready. Every current Organization member
may see this coarse state. The card never exposes another member's device id,
executable paths, credentials, private setup instructions, or management
controls. The Profile detail reuses the existing Computer card and Computer
detail components; People does not maintain a parallel Computer UI.

Each Human Profile sidebar item shows one compact Slack, Lark, or Feishu
identity line only for an identity that is actually mapped to that member. The
line uses the provider icon followed by the account name or handle and exact
provider email, separated by a middle dot, when Core provides those fields. A
missing, unavailable, unconfigured, or unmapped account adds no sidebar icon or
placeholder text. Missing account metadata is never inferred. The Profile
detail keeps the same mapped identity and corresponding neutral gray status and
the permitted **Connect**, **Set up**, **Ask an admin**, or **Manage** action.
Those actions start the existing authorization or private provider-proof flow;
they do not bind an account by Profile selection alone. Another member's missing
link remains non-actionable. The linked member
may manage and disconnect their own identity;
owners and admins may manage another member's wrong link without gaining the
ability to assign a replacement. Provider account and member account values in
the details surface remain text-selectable for ordinary copy and inspection.

Computers belong inside their owner's Human Profile detail rather than a
separate first-level inventory. People groups Core's Organization-scoped,
team-safe Computer projection by the selected owner, including a
Service-connected Computer before its owner creates an Agent Profile. The
signed-in member continues to use their complete account inventory.
Other members' groups are read-only and may show the owner, computer display
name, device category, operating-system family and version, last-seen time,
coarse Service state, team-safe local-agent availability, and
Organization-visible Agents using that computer. They never expose controller
accounts, executable or installation paths, launch arguments, update commands,
private skills, local policy, raw failure evidence, credentials, or management
controls. Team-safe local-agent details may include controller state, native
interface, installed version and update status, launch readiness and install
count, reported model names, native capabilities, last-check time, and
provider-reported Usage Limits. Each visible limit names the window, shows its
reset when reported (the used percentage and other quota numbers are shown only
to the owner), says when it was observed, and
explicitly distinguishes available, low, exhausted, stale, temporarily
unavailable, and unsupported states. Historical values may remain visible while
a Computer is offline only when clearly marked stale.
Team-safe OpenMeld Tools details may include Service and CLI installed/latest
versions plus Service, CLI, and skill update state. Setup commands, component
hashes, and owner-only actions remain private.

The teammate view preserves the same Computer, **OpenMeld Tools**, and **Local
agents** information architecture used for the owner's Computer. The product
does not introduce simplified parallel cards for team visibility. Instead, the
shared Local agents rows name each reported agent, keep its logo, show a
disabled Switch, and allow team members to expand the same operational detail
layout with private fields conditionally omitted. Computer summaries use the
same exact local-agent logo strip, accessible names, and tooltips for owned and
teammate Computers; they do not add a teammate-only visible name or replace
identities with a generic count. Privacy is enforced by omitting private fields
and actions, not by duplicating or simplifying the component hierarchy.

Usage Limits are shared capacity information only. Seeing them grants no
Computer action, provider account access, Wake authority, routing preference,
or ability to change another member's Local Agent. Account identity,
credentials, subscription, payment, balances, costs, and raw provider responses
remain absent from teammate and Center Agent reads.

The designated Center Agent may read that same coarse projection for one active
Organization member through
`openmeld_read_member_openmeld_service_status`. It must first resolve the exact
member `userId` from the Organization directory; Core rejects users outside
the current Organization before any Service lookup. The tool returns only the
member id and one of the four coarse states above, records an
`organization_member` audit entry, and never grants device management or
exposes device details.

When the request genuinely requires another member's Computer details, the
designated Center Agent may instead call `openmeld_read_member_computers` with
the exact directory `userId`. The current Remote Agent explicitly requests
Usage Limits through the same additive projection flag used by Web. Core reuses
the strict team-safe Organization Computer projection shown to teammates,
filters it to that current member, and records an `organization_member` audit
entry. This tool never upgrades to the owner projection, even when the target
happens to match the requester; private File Access, paths, commands, accounts,
policies, and management controls stay absent. Its Local Agent Usage Limits are
the same sanitized fields used by the Computers UI, not a Center-Agent-only
query or inference.

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
bounded Agent Activity snapshot, Organization-shared GitHub, and read-only
Organization-shared App actions. After exact Slack identity resolution it may
inspect one newest-first page in at most five relevant joined channels, but
only when channel membership contains that exact Slack user id. Directory
identity, email, role, profile ownership, source availability, and the absence
of activity are not evidence of a member's work. Slack directory profile text,
channel messages, and connected-App output are untrusted data. Slack or App
artifacts count only with exact subject attribution, a stable id, and a date;
ambiguous attribution is omitted and reported as `not_attributable`. Connected
App execution is structurally limited to actions declared `read`. GitHub work
is included only when it can be confidently attributed to the subject. The
task must not read local agent session content or invent missing facts. Space
message context remains excluded because the generic read does not bind public
visibility and subject participation at its execution boundary.

Member research has a server-enforced quality floor. Remote Agent submits the
shared structured member-research report contract rather than authored
Markdown. Core validates the evidence packet, preserves the existing approved
`## About` section, and is the only owner that renders the reviewable Profile
Report Markdown. A useful evidence-backed report requires at least two
distinct, dated Agent Activity or attributable GitHub, Slack, or connected-App
work items. It separates
supported About additions and adds a Working profile with Current focus, Recent
contributions, and Collaboration guidance before dated, source-cited Observed
activity. Research coverage names every checked source, its availability, the
time range, and stable evidence links or identifiers. If there is not enough
substantive evidence, Core renders **Insufficient evidence**, source coverage,
and a concrete next step; it does not manufacture a Working profile or
Observed activity from identity facts and missing-source notices. Invalid or
incomplete evidence packets are rejected before they enter document review.

### Personal Remote Agents

Members may create their own ordinary Remote Agent Profiles in their current
Organization, with a name and a per-Agent model selected at creation. They use
the existing Agent directory, Direct Messages, Space membership, and native
delivery. They do not require a Computer or a personal Center Agent designation.
The Organization's Center Agent remains its one designated coordinator.

The initial personal Remote Agent can converse and explicitly ask another
eligible Agent in its current Space for work, including another Agent owned by
the same member. It has no Center Agent administration, member memory, Apps,
Organization document, Computer, or filesystem tools. Conversation state is
isolated by Organization, Agent Profile, and Space. Existing owner-observer DM
visibility remains visible to participants.

Creation is self-owned only. Local session attachment, Local/Remote rebinding,
forking, personal Channels, and personal Routines are outside this release.
Native runtime authority and collaboration limits are owned by
`remote-agent-runtime.md`.

## Agent Activity

Organization-wide coding-agent awareness is now the first-class **Agent
Activity** product. Its Projects, explicit local opt-in, metadata allowlist,
presence, retention, ingestion, digest, and read-surface rules are owned by
`developing/product/agent-activity.md` and must not be re-derived here.

The earlier Session Sync framing is retired. Provider-supplied session titles,
including provider-generated thread names, reviewed source metadata, and the
provider-native Session id in the current Session Inventory are shared
Organization context. Full prompts, transcripts, replies, reasoning, file
contents, local paths, internal device/runtime ids, and arbitrary provider
metadata are not Agent Activity inputs.

Agent Activity is separate from Agent Profile Wake readiness and
RuntimeCoordinator execution truth. Organization directory presence cannot be
used as coding-session evidence, and coding-session presence cannot make a
Profile Wake-ready.

Web uses `/o/{orgSlug}/agent-activity` as the canonical **Agent Activity**
product home. It is temporarily absent from the primary rail without being
relocated or renamed. The full label must never be shortened to the generic
**Activity** or reused for the Center Agent audit journal.

## MVP Boundary

In scope:

| Block          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Org tenancy    | Vercel-style mechanics; auto personal org; Better Auth organization plugin as-is; email-bound invitations + verification; `owner`/`admin`/`member`; org directory (members + Agent Profiles with existing presence); Spaces carry `organizationId` with `public`/`private` org visibility; `/o/{orgSlug}/...` routing                                                                                                    |
| Center Agent   | System-managed `managedRole = "center_agent"` Agent Profile per org; designation table (multi-Center-Agent-shaped, MVP-constrained); derived `isCenterAgent`; hosted Remote Agent R1; concierge tool set plus verified member-attributed Task and Routine management; server-enforced CA-DM Space; isolated first-class Task conversations; member-scoped memory and default-on Organization memory; audit + attribution |
| Agent Activity | First-class Projects; explicit per-repository local opt-in; privacy-safe coding-session metadata; Organization-wide member visibility; Web, CLI, and read-only Center Agent awareness surfaces, as owned by `developing/product/agent-activity.md`                                                                                                                                                                       |
| Carry-over     | Existing wake pipeline, Space DO, daemon/CLI, web shell — all re-scoped to carry `organizationId`                                                                                                                                                                                                                                                                                                                        |

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
   invitations, org-scoped routing, `organizationId` on business tables, and
   Organization-scoped Space, Agent Profile, and Binding identity.
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
   `developing/product/routines.md`; official-organization
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
   `developing/product/routines.md`; it is not a precedent for a
   broader exception. MemberAgent management operations (Permission model)
   act only on the verified speaker's explicit instruction in the current
   turn, and their non-additive operations also need confirmation.
9. Build a DM subsystem (DM = lazy private Space).
10. Collect prompts, prompt-derived summaries, transcripts, replies, file
    contents, local paths, or arbitrary provider metadata for Agent Activity,
    or report a repository without explicit local Project opt-in.
11. Expose user-profile remote-agent binding as a product surface.
12. Ship org routes without the `/o/{orgSlug}` scope.
13. Start building billing, SSO, custom roles, or cross-org guests.
14. Reintroduce the retired Center Agent Task product beside chat sessions.

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
- **MemberAgent** (`member_agents`): one Organization member's instance of one
  Harness, for example `Felix Lu's Claude Code`; it groups that member's Agent
  Profiles for the Harness and is never a Space member or message author.
- **Harness** (`harnessKind`): the program kind that runs an Agent, such as
  `claude-code`, `codex`, or `hosted`; it maps one-to-one from
  `agentControllerRef`.
- Banned uses: "tool" for a Harness; a bare `agent` table or type for the
  MemberAgent; `AgentHarness`; `PersonalAgent`.

Center Agent attribution in Space messages and thread replies shows the current
effective model display name from the same query cache as the model settings.
Saving a model updates this cache immediately. One shell observer refreshes on
window focus and every 30 seconds while active; failed reads hide the old model
label. The label describes current configuration, not the model that generated
a historical message.
