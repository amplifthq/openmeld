# Presentation Model: Progressive Disclosure

## Agent Context

- Purpose: Preserve the settled progressive-disclosure principles and the
  reasoning behind OpenMeld's Organization and Center Agent presentation. The
  current Web navigation and Settings topology are owned by
  `developing/clients/web.md`.
- Read this when: You are changing the context selector, onboarding surfaces,
  Space creation, Wake-access authorization UX, or user-facing copy that names
  Organizations or the personal context. Read `developing/clients/web.md`
  first for current navigation, Settings placement, and migration status.
- Update this when: Felix settles a new presentation decision or reverses one
  recorded here. Record reversals in `developing/decisions.md` in the same PR.
- Do not use this for: Current Web navigation, Settings placement, or Center
  Agent management-home implementation; those are owned by
  `developing/clients/web.md` and
  `developing/product/organizations-and-center-agent.md`. Tenancy architecture
  and red lines belong to the Organization owner; Space semantics belong to
  `developing/product/space-collaboration.md`.
- Source of truth: This file owns only the progressive-disclosure and
  authorization-UX principles that have not been superseded by a narrower
  owner. `developing/clients/web.md` owns current navigation structure and
  `developing/product/organizations-and-center-agent.md` owns the Center Agent
  home and management boundaries.

## Current scope

The 2026-07-13 W-NAV target in `developing/clients/web.md` supersedes this
document's former sidebar,
Organization-section, Center Agent tab, Channels/Apps handoff, and Settings
placement. The product narrative, permanently-solo personal Organization,
Wake-access authorization, Space visibility, and other explicitly retained
principles below remain active. Do not implement a historical navigation shape
from this document. Remove this file when the retained principles are absorbed
into their owner documents and only superseded material remains.

## Product Narrative (the mother copy)

All onboarding, landing, and empty-state copy derives from this story, in
this order:

> OpenMeld turns the AI coding agents on your computers into teammates you
> can summon from anywhere. You open a Space, bring your agents in, and
> @-mention one to put it to work — it runs on your machine and posts results
> back. Your Center Agent is your chief of staff: it coordinates your whole
> agent fleet.
>
> When you are ready to work with other people, create an organization —
> share agents, see each other's fleet in one directory, and let a Center
> Agent coordinate the team.

The first paragraph is the solo loop (lesson one). The second is collaboration
(lesson two). **A new user must be able to complete lesson one without first
understanding or configuring an Organization.** The fixed rail may expose
Directory guidance and a Create organization entry, but neither may interrupt
or gate the solo loop. One person commanding an agent fleet is already a
complete Organization in the data model.

## First Principle: the selector governs everything

The sidebar runs under one rule:

> Every top-level item means "**the current context's** X". Switching context
> changes content, never structure. No top-level item appears, disappears, or
> moves because of which context is active.

**Workspace** is the Web presentation term for the selected Organization
context; it is not a second tenant type or an API/domain rename. The selector
is the single scope switch. This kills the "does Center Agent belong to me or
to the Organization?" question structurally: every primary destination belongs
to the current workspace, and the page names its owner where useful.

## Disclosure Layers

| Layer | Concepts | When visible |
| --- | --- | --- |
| Global structure | Work: Center Agent, Spaces, Direct Messages; Team: People, Agents, Computers; Resources: Projects, Documents, Agent Activity; the Settings utility; and the workspace switcher | From first sign-in, in the same order for every workspace and role |
| Contextual collaboration content | Organization members, invitations, roles, shared access, and Organization directory-listing controls | Only when the selected workspace and current role make the content meaningful; the destination itself remains present |
| Never surfaced as domain truth | "personal org" as a separate tenant type and per-Binding authorization mechanics in ordinary product flows | — |

Rationale for the split: we hide the **organization of people**, never the
**organization of agents**. A solo user has no colleagues but does have a
fleet — and commanding the fleet (Center Agent) is the product's core, so it
is first-level in every context (the one-person-company story).

## Current Navigation Principle

The sidebar structure from the original 2026-07-05 design is superseded. The
approved fixed product rail uses **Work** for **Center Agent / Spaces / Direct
Messages**, **Team** for **People / Agents / Computers**, and **Resources** for
**Projects / Documents / Agent Activity** in both personal and multi-member
workspaces, with **Settings** separated as a utility. The complete placement
rules live in `developing/clients/web.md`; do not restore the former Directory,
Profiles, or Organization rail, the Artifacts placeholder, or context-dependent
navigation slots.

The workspace switcher remains the single context selector. The personal
workspace is pinned first, Organizations follow, and Create/Manage organization
actions live in that selector. Switching workspace changes content and owner
scope, not the nine product destinations or their order.

## Current Center Agent Presentation

One product per context uses the same first rail slot and never moves. Center
Agent has no secondary sidebar. Its daily work is the full-width conversation
with stable header navigation: **Messages, Graph, Files, Tasks, Routines,
Skills, Apps**. Lower-frequency destinations live in one compact header menu:
**Channels, Memory, Center Agent settings**. The conversation variant also
contains **Conversation information**. There is no separate About surface.
Center Agent configuration lives once under **Center Agent → Center Agent
settings**; the former multi-tab management panel is retired rather than
preserved as a hidden or personal-only route.

- Header names the owner: "Coordinator agent for Felix Lu" / "… for Acme".
- **Chat** remains the low-friction place to start work and ask the resident
  Center Agent for coordination. **Tasks** is the durable work home: a read-only
  **Active / Needs action / Finished** board and conversation-first Task detail.
  It does not expose user-managed chat sessions.
- Designation state card: designated → profile identity (display name,
  avatar, designatedBy, since) + revoke; empty → explanation + designate
  flow (owner/admin only; in the personal context the user is always owner).
- Designate flow: pick an Agent Profile of this context; replacing an
  existing designation requires an explicit "this replaces the current
  Center Agent" confirmation.
- The current **Audit Log** lives under
  **Center Agent → Center Agent settings** and is readable by every current
  workspace member. Mutation controls on that page remain role-gated. The
  Routine owner contract defines the requester-attributed Routine mutation rows
  exposed through the current Audit Log action set.
- The former Manage Center Agent tabs are retired as a parallel management
  panel. Their surviving product destinations live in the stable header or its
  compact menu.
- **Channels** and **Apps** remain separate. Never group Slack conversation
  routing and GitHub tool access under one generic `Connections` heading.
  Channels are places where people and systems can message the Center Agent and
  receive replies. A connected Channel is also a primary product entrance:
  internal workspace members receive ordinary Organization value there before
  they have an OpenMeld account.
- In every workspace, **Center Agent → Channels** and **Center Agent → Apps**
  are the single management homes. All members may view
  Organization-owned status; only owners and admins mutate Organization-owned
  access, while members may manage their own member App connections.
- Message Channel replies are result-first. An unlinked internal member never
  sees an account-status warning before work that the Center Agent can already
  complete, and a successful ordinary task receives no unsolicited connection
  prompt afterward. If the requested action actually requires linked identity,
  the reply names only that blocked action and provides one private **Connect my
  account and continue** action after completing every independent safe part.
  A non-continuing connection action appears only when the user explicitly asks
  to connect the provider account.
- The page is the future home for Center Agent depth: duty definition,
  internal docs, runtime status, remote-runtime upgrade entry. Reserve the
  layout for growth; do not compress it into a card on another page.
- Personal-context concierge toolset excludes member invitation (the
  personal context cannot take members — see below). The role template stays
  single-source; context-specific wording (solo chief-of-staff vs team
  dispatcher) is a noted future refinement, not MVP.
- A persistent bottom-right Center Agent control opens a compact view of the
  same canonical Chat or Task. It never creates a new session. From Task detail
  it opens that Task; elsewhere it may restore the member's last authorized
  Center Agent location. Maximize preserves the exact Chat or Task destination.
  The compact control is a shortcut, while **Center Agent → Tasks** remains the
  durable management home.

The complete Task context, visibility, Channel, concurrency, recovery, Inbox,
board/detail, and compact-window contract is owned by
`developing/product/center-agent-tasks.md`.

## The Personal Context Is Permanently Solo

Settled 2026-07-05 (amends the earlier "a personal org grows into a team
org" direction):

- The auto-created personal organization **never takes members**. The server
  rejects invitations to it (fail closed), marked via organization
  `metadata` (`personal: true`) — no schema column, no separate code path
  beyond this guard.
- Collaboration always starts by **creating a new organization**. The
  personal context stays the user's private garden forever — a stable mental
  anchor.
- **Growth path** ("bring your agents"): after the minimal Organization
  creation form succeeds, the shared Organization entry dialog offers Wake
  access for the user's existing bound Agent Profiles. Implementation is *not*
  data duplication: Agent Profile identities and Bindings remain user-owned,
  and the explicit choice authorizes those Bindings for the new Organization.
  Spaces do not move (deferred; the Center Agent can carry context summaries
  into new Spaces when asked).
- Rejected: duplicating Spaces/Profiles into the new org on invite. Copies
  diverge and confuse identity; a copy is not cleanliness, it is double the
  mess.

## Naming and URLs

- The personal organization's `name` **is the user's name** at the data level.
  Web may use **Personal** only as the pinned workspace-switcher presentation
  label; it is not the stored name or a second tenant type. The Organization
  name can be renamed through its canonical workspace settings (account
  renames do not auto-propagate; acceptable).
- Organization names are display identity and are never globally unique. Auth
  generates every new Organization URL slug from the readable name plus a
  six-character cryptographically random public discriminator (for example,
  `acme-labs-k7m3qx`). Personal Organizations use the same rule. The
  discriminator is not an ordinal, database count, UUID prefix, or internal
  Organization id, so same-named Organizations neither block one another nor
  disclose creation order. Auth retries an exact collision while the database
  unique index remains the final constraint.
- Creation asks only for the Organization name. Existing slugs remain unchanged,
  and slugs remain editable through canonical Organization settings for an
  explicit custom URL. Renaming an Organization does not silently change its
  URL. `/o/{slug}` remains a mutable selector; immutable Organization id remains
  the identity and authorization authority.
- A global slug **reserved list** (route and anti-phishing words such as
  `admin`, `support`, `api`, `www`, `mail`, `help`, and `security`) applies to
  derivation and manual edits. `openmeld` remains available for the official
  Organization because official product Organizations are ordinary tenant data,
  not hard-coded system tenants.
- **Personal** is a narrow Web navigation label, not a domain rename. APIs,
  schemas, storage, CLI Organization identity, email Organization identity,
  and owner docs continue to use the stored Organization name.

## Wake Access Authorization UX (the three-piece model)

Authorization records stay per-`(organization, binding)`, individually
revocable, fail closed — unchanged. What changes is how they are created:

1. **Personal context: fully automatic and invisible.** The user's own
   bindings are auto-authorized in their personal organization. Own machine,
   own garden, zero concepts.
2. **Organization entry: one explicit choice in the shared dialog.** Creation
   collects only the Organization name, then opens the Organization
   without writing a Wake preference. The unanswered preference opens the same
   default-checked Wake access choice used after joining. Confirming atomically
   writes the current Binding authorization records and saves automatic
   authorization for the user's future bound Agent Profiles.
3. **Organization settings: a per-user-per-org preference** — "Automatically
   authorize my new Agent Profiles in this organization." It governs only
   the *user's own* agents: bindings are user-owned and nobody can authorize
   another person's binding, including owners.

When a user creates a bound Agent Profile from an organization-scoped creation
surface, including Agent Profiles and Space member creation flows, the Agent
Profile identity still belongs to the user's account, but the creation flow
must immediately handle organization Wake access intent. If the user's
auto-authorization preference is already on for that organization, Web
authorizes the new Binding without another prompt. If it is off, Web asks
whether to use this Agent Profile in the current organization and offers to
turn on automatic authorization for future new Agent Profiles. Choosing not to
use it in the organization creates the Agent Profile only in the user's
account.

**Rebind inheritance** (settled): when the same user rebinds a profile (new
computer, new controller, local→remote runtime switch), existing org
authorizations **carry over automatically**, each carry-over recorded in the
audit journal. The user's intent — "my agent may be woken in this org" — did
not change; only the machine did, and the journal keeps the trail.

This amends the baseline's "Wake authorization stays opt-in per Binding":
opt-in now includes explicitly approved bulk/automatic policies. Records
remain per-binding and revocable; fail-closed enforcement is untouched.

Account Setup Studio presents the Core-owned Workspace memory default as on
without manufacturing a user choice. Organization owners and admins may change
the policy in the Defaults step; other members see the real policy read-only
and can never invoke its mutation. Personal Workspace onboarding keeps its
shorter path and makes the confirmed default visible on Ready instead of adding
another question. Wake access remains a separate member-scoped choice.

After Wake access is saved, the same dialog remains open for an optional Slack
Channel and GitHub App step. Slack is writable only for an owner or admin.
GitHub keeps member-owned and Organization-shared scopes explicit: a member may
connect their account, while an owner or admin may connect shared access. OAuth
runs in provider popups while the original dialog remains visible, and only the
owning Core projection proves success. Provider popup liveness is not product
truth because cross-origin isolation may detach the opener relationship;
explicit Cancel and timeout remain the non-success exits. Back changes only the
visible step and does not undo saved facts. A saved enabled or disabled Wake
preference means the dialog has been answered and must not appear again after
the current session finishes.

## Space Visibility Presentation (two orthogonal axes)

- **Personal context**: Space creation shows **Link access only** (open /
  view with password / password). Organization directory listing is silently
  `private` — a solo directory listing has no meaning. The two-axis conflict
  cannot appear.
- **Org contexts**: both axes show, re-worded to state their scopes —
  "**Organization directory listing**" (listed and joinable in this org's
  Space directory / unlisted) and "**Link access**" (what the link does for
  someone who has it). Org-unlisted + link-open is valid and useful (the
  Google Docs "unlisted" model).
- The wire contract keeps visibility explicit and required; defaults live in
  the client only (existing decision, restated for scope).

## Context-Switching Behavior

- **Creating an organization switches to it immediately** (selector and URL
  follow; the bring-your-agents wizard runs in the new context).
- **Landing rule on switch**: the six product destinations and Settings utility
  exist in every workspace, so switching preserves the current destination and
  changes its owner scope. An obsolete, removed, or invalid deep route falls
  back to the target workspace's Center Agent home; workspace kind alone is
  never a reason to move a valid destination.
- Accepting an invitation lands in that org's context.

## Amendments This Spec Makes to the Baseline

Land these in `developing/product/organizations-and-center-agent.md` and
`developing/decisions.md` together with the first implementation PR:

1. Personal organizations are permanently solo (metadata-marked, server
   rejects invitations; fail closed). Replaces "a personal org grows into a
   team org by inviting members; no migration moment" — growth now happens
   by creating a new organization plus the bring-your-agents wizard.
2. Wake authorization opt-in extends to explicitly approved bulk/automatic
   policies (three-piece model above) and rebind inheritance with audit.
3. The personal organization's name is the user's name at the data level;
   Web may use **Personal** only as its pinned workspace-navigation label;
   slugs are human-friendly with a reserved list.
4. Center Agent presentation is first-level in all contexts (this was
   presentation-undefined before; the designation/authz architecture is
   unchanged).

Red lines untouched: one Center Agent per org, derived `isCenterAgent`, no
special transport, additive-only permissions, organization naming, teams
disabled, `/o/` scope.

## Backlog (deliberately deferred)

- Space migration between contexts — revisit post-MVP; interim answer is
  new Space + Center Agent carrying context.
- Context-aware Center Agent role-template wording (solo vs team).
- Account-rename propagation to the personal organization name.
- Bind/rebind concept surfacing (the "badge vs desk" story) in product
  copy — fold into the Computers/Agent Profiles surfaces when next touched.

## Acceptance Shape for Implementation Tickets

A ticket implementing the retained principles is done when a fresh user can:
sign up → land on the Center Agent in the personal workspace → see the same
six-product rail and Settings utility used by every workspace → ask the Center
Agent or explicitly create a Space → connect a computer → wake an agent without meeting Binding
authorization mechanics. **Directory → People** remains present and explains
that collaboration requires an Organization instead of attempting a personal-
workspace invitation. An Organization creator gets: creation → immediate
workspace switch → the same destination preserved → one Wake-access prompt
when needed → bring-your-agents guidance → role-appropriate Directory and
Organization Settings content.
