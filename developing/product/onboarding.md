# Onboarding

## Agent Context

- Purpose: Define the product behavior of OpenMeld onboarding — the Web first-run
  flow, the in-Space setup banner, and the `openmeld start` / `openmeld setup`
  / `openmeld doctor` CLI surfaces — and the planner boundary those surfaces are
  converging on.
- Read this when: You are building or changing any onboarding surface, the
  start planner in `packages/start`, the Web first-run screens, the in-Space
  setup banner, setup-related CLI output, or anything that tells a user or
  agent "what to do next" about identity, Spaces, agents, or this computer.
- Update this when: An onboarding step is added, removed, reordered, or
  reworded; the planner decision contract changes; a new renderer (Desktop
  GUI, Invite acceptance) starts consuming the planner; or an invariant below
  must change (change it here first, in the same PR, with reasoning).
- Do not use this for: Space membership write semantics (owned by
  `developing/product/space-collaboration.md`), daemon lifecycle and Prepare
  internals (owned by `developing/architecture/local-openmeld-service.md`), shared
  schema rules (owned by `developing/architecture/shared-contracts.md`), or
  Auth-owned invitation and join-link write semantics.
- Source of truth: This file owns onboarding product behavior and the
  planner/renderer boundary. On conflict between an implementation and this
  document, this document wins; if the implementation is right, amend this
  document in the same PR.

## Product Role

OpenMeld has two complementary onboarding layers:

1. **Account Setup Studio** is the full-screen, low-friction first product
   entry for every account that has not completed the current onboarding
   version. It helps the user explicitly choose a Personal Workspace or an
   Organization, then optionally connect the real infrastructure that makes
   OpenMeld useful in that scope.
2. **Contextual setup guidance** remains a permanent, fact-driven answer to
   "what is the most useful next action on this surface right now?" The
   in-Space banner and CLI setup/doctor surfaces consume the existing pure
   planner and do not depend on Setup Studio completion.

Setup Studio is not a tutorial simulation. Every action reads or writes the
same owning data used by the rest of the product. Its right-hand demonstrations
explain the outcome without asking a beginner to invent a prompt or understand
OpenMeld's internal architecture first.

A connected Message Channel member has two deliberately different setup
affordances. Neither is another onboarding planner or a reusable Organization
invitation.

After the Center Agent successfully completes work without linked identity, it
does not show an account warning or unsolicited connection prompt. The result
stands on its own. A private **Connect my account** action is appropriate only
when the user explicitly asks to connect accounts or when the current request
reaches a capability that genuinely needs that person's OpenMeld account.

When the requested Slack, Lark, or Feishu action actually needs verified
identity, the Center Agent attaches one private action-scoped handoff:
**Connect my account and continue**. Before requesting that action, Center
Agent may compare the current provider name and available email with the
current Organization directory. When one current member is clearly the same
person, Core binds the one-time action to that OpenMeld user. Otherwise the
action remains an open sign-in or sign-up handoff. The link preserves the
original request, shows the provider account and signed-in OpenMeld account,
and asks for one explicit confirmation. It then continues the original request
in the same conversation. A known continuation failure keeps the completed
link and offers one retry action. The user never has to understand identity
matching, find an administrator, navigate settings, or repeat the request.

The comparison is not onboarding state and is not proof of identity. No
background scan, Candidate record, Inbox item, or email is part of the initial
flow. A Channel reply cannot confirm the link. A different signed-in account,
lost membership, changed provider connection, conflict, or expired action fails
closed without revealing another member's account details.

The two layers deliberately have different state:

```text
Account Setup Studio:
versioned account-local presentation progress
  + Auth/Core/Gateway real facts
  -> full-screen Web flow

Contextual guidance:
auth/profile/membership/device facts
  -> buildOnboardingPlan (packages/start, pure)
  -> Web banner, openmeld setup / doctor, agent-view JSON
```

Local Setup Studio progress records only the current presentation step,
selected Workspace id, completion timestamp, and intended return route. It
is never a source of Organization membership, connection, policy, Agent
Profile, Service, or readiness truth.

Setup flow presentation copy for the shared CLI/Prepare experience remains in
`packages/start` (`presentation/setup-flow-copy.ts`). Setup Studio embeds that
production Web setup surface for the optional computer step rather than
forking its command, PrepareSession, or live-status behavior.

## Product Invariants

1. **Configured value before abstract teaching.** Setup Studio first helps the
   user establish the environment that gives Center Agent leverage. It does not
   begin by asking the user to understand or chat with Center Agent. Concepts
   such as multi-Agent collaboration, Activity, Routines, Skills, and
   Playbooks belong to later tutorials and contextual discovery. When the Web
   first-run Space choice offers computer setup, **Connect Computer** is the
   primary full-card action. The sentence below may offer **Center Agent** as an
   underlined inline link for optional guidance; it must not promote that
   navigation into a separate button that competes with computer setup.
2. **Low friction is a product requirement.** Every step after Workspace
   selection is optional. The user may skip the whole flow, continue while
   computer setup runs, and move backward without losing completed work. No
   optional integration failure may trap the user.
3. **Real facts, never onboarding copies.** Organization membership, Channels,
   Apps, App requests, local runtime inventory, Organization memory, Wake
   access, Organization documents, Information Protection, and invitations
   remain owned by their existing Auth/Core/Gateway contracts. Setup Studio
   reads and mutates those same facts.
4. **Presentation progress is allowed; product truth is not duplicated.**
   Versioned, account-scoped local storage may remember the current Setup Studio
   step and completion. Re-entering or restarting the flow must reconcile every
   control against live owning data. It must never create a second connection,
   policy, or readiness state. This allowance applies only to Setup Studio.
   Contextual guidance stores no current step or completion token and recomputes
   its presentation from current facts on every render.
5. **Permissions shape the flow.** An owner/admin may connect shared
   Organization capabilities, invite members, edit the Organization brief, and
   edit Information Protection. A member sees existing shared status, may use
   supported personal connections, and never mounts unauthorized read or write
   requests.
6. **Every mutation is optimistic where a truthful provisional state exists.**
   Update the owning query cache immediately and roll back the exact affected
   value on failure. When a server-generated secret is unknowable in advance
   (for example a new invite-link token), show an immediate pending outcome
   while retaining the last confirmed value; never invent a token or success.
7. **Defaults are visible, not interrogative.** Untouched Workspace memory
   and automatic Wake access default on. Setup Studio tells the user they are
   enabled and allows an authorized user to turn them off. It does not ask
   again when a prior explicit choice already exists.
8. **Separate membership, Service, and wakeability.** Joining an Organization
   or Space, connecting this computer, detecting Codex, and proving an Agent
   Profile can currently be woken are separate facts. Setup Studio may summarize
   only the facts it actually reads; it never derives Wake availability from a
   connected Service.
9. **One management home after onboarding.** Setup Studio is a guided entry to
   existing mutations. Channels, Apps, People, Agents, Settings, Computers, and
   Documents remain their ongoing management homes. The old Organization-entry
   onboarding dialog is retired; two onboarding surfaces must not compete.
10. **Concrete language and visual demonstration.** User copy says Slack,
    Lark, GitHub, Codex, or Claude Code instead of internal categories such as
    "coding agents." Each recommendation has a concise visual demonstration.
    Copy stays short enough to scan; the UI must not rely on paragraphs to
    explain the product.
11. **Membership is never gated by machine setup.** Joining an Organization or
    Space is a server-side fact. A missing Service, local agent, or readiness
    result cannot block or undo it. Contextual setup decisions appear after the
    joined fact and remain non-blocking.
12. **Contextual decisions converge through one planner.** Durable contextual
    decisions come from `buildOnboardingPlan` in `packages/start`. The in-Space
    banner, `openmeld setup`, and default `openmeld doctor --view agent` consume
    or emit that shared boundary. `openmeld start` remains identity and Space
    entry only, and points machine setup to `openmeld setup`. A shared
    contextual rule is a planner change plus tests, not a client-only branch.
13. **Contextual setup stays optional and recallable.** Dismissing the in-Space
    banner never deletes facts. It hides the surface until recalled or until a
    changed fact introduces another available action. A Space used only for
    human conversation must be one dismissal away from a clean conversation.
14. **One human-facing machine setup verb.** The command for making this
    computer work is `openmeld setup`. `openmeld doctor` is its read-only twin:
    it uses the same planner, prints the plan, and changes nothing. Adding
    another human-facing setup or repair verb requires amending this document
    and `developing/clients/cli.md`.
15. **One setup workflow, adapted to its host.** Setup Studio, the centralized
    Connect page, and the Center Agent Direct Message reuse the same command,
    expiry, Prepare Session, update verification, and completion owner. Setup
    Studio embeds it without its own completion actions. A generic Space banner
    links to the Connect page; a first-party Center Agent Direct Message may
    host the workflow inline; Slack and Lark receive the authoritative
    Connect-page action. Different hosts may change presentation, never setup
    semantics, copy ownership, or state machines.
16. **A brief Terminal disconnect recovers in place.** The CLI keeps the same
    Prepare Session and retries during the shared bounded reconnect window.
    Web shows reconnecting during that window and asks for a fresh command only
    after recovery does not converge, the command expires, or a real blocker
    requires a new handoff. A transient socket close is not user action.

## The Start Planner (`packages/start`)

This planner owns contextual setup decisions after product entry. It does not
sequence Account Setup Studio, because Organization/Channel/App/invitation
choices are Web orchestration over their own live owners rather than
cross-client setup decisions. A rule used by both contextual Web guidance and
CLI setup still belongs in this planner; a Setup Studio-only presentation step
does not.

Ownership and purity:

- The canonical onboarding planner is `buildOnboardingPlan` in
  `packages/start` (`planner/onboarding-plan.ts`); its contract lives in
  `packages/schemas` (`start/onboarding-plan`) per the shared-contract rule.
  The older `plan-start-next-action` planner and its `StartNextActionId`
  taxonomy (`build-start-foundation-state` / `StartSharedState`) have been
  removed. Do not reintroduce a second onboarding planner.
- The package must stay free of React, DOM, network, storage, and process
  dependencies. Facts arrive as inputs to the pure function. This is what
  keeps Desktop GUI and agent automation free to consume it later.

Inputs (fact families):

1. Auth session: signed in or not; the acting human profile id and its
   display name (the id is used to build executable agent-view commands).
2. Account profiles: the caller's Human and Agent Profiles with kind and
   active state.
3. Target-Space membership snapshot: whether the acting profile and its
   agents are members of the Space in context (when a Space is in context).
4. Device and service evidence: is this computer's OpenMeld Service connected.
   This is the live "OpenMeld Service Connected" fact (heartbeat-driven, the same
   fact the Agents page shows); the planner consumes it, never re-derives it.
5. Context slot: optional, reserved. Today it is empty or a Web setup
   handoff (`--start-session`); the Invite system will later inject an invite
   context here. The slot exists in the contract now so adding Invite does
   not change the planner signature.

Agent wake availability ("can this agent be woken right now":
available / checking / offline / unavailable) is deliberately NOT a planner
input. It is the Space member badge's job, rendered directly from the
existing `agentWakeAvailability` snapshot — Service is Service, Agent is
Agent. The onboarding plan tracks two separate facts: is the computer
connected (`connect_this_computer`), and is an agent in this Space
(`bring_agents`). It never merges live agent wakeability into either.

Output: an ordered list of decisions. Each decision carries at least:

- `id`: stable action identifier from the `onboardingActionId` enum
  (snake_case): `sign_in`, `set_display_name`, `enter_space`,
  `bring_agents`, `connect_this_computer`.
- `status`: `done`, `available`, or `blocked` (blocked = prerequisites
  missing, with the prerequisite named in the reason).
- `blocking`: whether later decisions depend on it. Setup-type decisions
  after the joined fact are non-blocking by Invariant 2.
- `reason`: machine reason code (snake_case per
  `shared-contracts.md` Machine Output Code Naming).
- `run`: for CLI-executable actions, the exact command an agent should run,
  with explicit arguments and `--view agent`. It is complete: the
  acting profile is included where the command needs it (e.g.
  `openmeld space add-agents <spaceId> --profile <acting-id> --all --view agent`),
  and a Web setup handoff carries its token
  (`openmeld setup --start-session <token> --view agent`).
- `afterRun`: machine hint for the agent loop after running `run`
  (e.g. `rerun_setup`; null otherwise). Named `afterRun`, not `then`, because
  a `then` object key trips thenable-detection lint.
- Copy is resolved by renderers from the decision id, not embedded
  free-text per client.

Required properties, each pinned by unit tests in `packages/start`:

- Deterministic: same facts, same list.
- Idempotent and re-entrant: recomputing after any subset of actions
  completes yields the remaining actions in stable order.
- Complete: for every reachable fact combination the list is either
  non-empty or explicitly "nothing to do"; no fact combination may produce
  an unexplained empty state.
- Honest: a decision may only be emitted from facts the planner received;
  it never speculates (no "probably needs setup").

State-aware decision set (the planner emits only what is meaningful for the
current facts — progressive disclosure, never a disabled action):

- A decision is emitted only when the user can actually act on it now. The
  planner does not emit an action and let renderers grey it out; absent
  prerequisites mean the action is not in the list (or is `blocked` only when
  the user would otherwise look for it and be confused by its absence).
- Zero Agent Profiles: do not emit `bring_agents` — there is nothing to
  bring. The meaningful action is getting a first agent, which is the
  `connect_this_computer` decision. (Renderers adapt that decision's copy by
  fact: a zero-agent user is told they are setting up their first agent; a
  user who already has agents is told to connect this computer so they reply.
  Same decision id, fact-driven copy — never two ids.)
- Has Agent Profiles, this computer not connected: `bring_agents` and
  `connect_this_computer` are both meaningful and independent; emit both,
  neither blocking the other.
- Pinned by the Complete/Honest property tests above: the zero-agent fact
  fixture must not yield `bring_agents`; the has-agents fixture must.

## Web: Account Setup Studio

### Entry and completion

Every authenticated account with no completion record for the current Setup
Studio version is redirected from the app shell to
`/o/:orgSlug/onboarding`. This intentionally includes existing internal users
when the feature first ships; the migration is the absence of the new
versioned local record.

Completion is account-scoped, not Organization-scoped. A person should not be
forced through the entire Studio for every Organization. The selected
Organization is stored only to preserve navigation intent. Every
Organization-specific control still loads its current live value.

`Skip setup` completes the current version and returns to the originally
requested feature, retargeted to the Organization selected in the Studio.
`Open OpenMeld` on the final screen does the same. Before it records completion,
Web opens the canonical Center Agent Direct Message once so Core can materialize
the selected Workspace's designated Center Agent through its existing owner
path. A failed initialization keeps the person on Ready with one retry action;
it must not expose Home with an unavailable Center Agent or add another writer.
When there is no valid originally requested feature, completion opens the
selected Workspace's Home. The user can always open the stable onboarding route
directly to run the Studio again. Direct re-entry clears only presentation
completion and starts at Workspace selection; it does not reset any product
data. `?restart=1` provides the same deterministic presentation reset for local
development and smoke.

### Layout and interaction

Setup Studio is full-screen and split into two areas on desktop:

- left: one concise decision or real configuration surface;
- right: a dark, programmatic demonstration of the outcome.

Small screens show the left interaction surface without making the demo a
prerequisite. The header has OpenMeld identity, compact progress, Back after
the first step, and a persistent `Skip setup` action until the result screen.
Completed mutations survive Back/Forward because the next mount reads the
owning query again. Inline errors preserve context and never erase a successful
sibling mutation.

### Step order

1. **Workspace — "Choose your workspace"**
   - Always show `Personal Workspace` first as an explicit real choice with
     `Private to you`; `Skip setup` is never a substitute for choosing it.
   - Show existing non-personal Organizations under a separate
     `Organizations` label.
   - Show pending email invitations from Better Auth and let the user join in
     place.
   - Offer Create Organization and Join with invite link.
   - Create, invitation acceptance, and join-link acceptance update the
     Organization scope cache optimistically and roll back exactly on failure.
   - The demonstration uses up to three real Directory first names for an
     Organization and only the current user's real first name for Personal
     Workspace. It never invents people or renders unexplained initials.
   - Personal Workspace shows `Private to you`; an Organization shows
     `Shared with your team`.
2. **Channels — "Bring OpenMeld into the conversation" (Organization only)**
   - Show Slack and Lark/Feishu with their real connected state.
   - A connected Channel keeps its check and `Connected` label together beside
     the Channel name. Do not repeat a second generic `Connected` action label.
   - Owners/admins receive the existing Organization connection actions.
     Members see shared status and only actions their role permits.
   - Slack success comes only from the Core-owned designation after OAuth;
     popup state is not success. Lark/Feishu reuse the shipped registration
     owner.
3. **Apps — "Connect your team's context" / "Connect your context"**
   - Search the live OpenConnector provider catalog. Recommended Apps appear
     first; search reaches the entire catalog.
   - Apps with an OpenMeld-ready auth path use the existing connection UI.
   - Other catalog Apps show `Request`; a free-form request covers providers
     not found in the catalog.
   - Requests write the internal connector-request ledger with requester
     identity and lifecycle fields so later availability notifications can be
     backfilled. App-release notification is a later enhancement.
   - Personal connections say that only the current user can use them. Shared
     connections identify the Organization or Workspace scope and the member
     who authorized them. A shared GitHub connection is presented specifically
     as the OpenMeld GitHub App, including who installed it and that
     Organization work runs as the OpenMeld bot.
   - A cached connection remains visible while its owner is refreshed, but
     Connect and Disconnect show an explicit checking state and remain disabled
     until the current read succeeds. A failed refresh keeps the last visible
     fact, shows a retry action, and never enables a stale mutation.
4. **This computer — "Use Codex or Claude Code with OpenMeld"**
   - Show Codex, Claude Code, Cursor, and OpenCode by name and logo.
   - Their compact cards use the shared sharp-corner Card primitive. Logos are
     visually primary and do not sit inside another bordered or padded frame.
   - Embed the production setup/Prepare surface: one-time command, expiry,
     Terminal progress, and current local runtime projection.
   - On re-entry or restart, first reconcile the current computer's real
     Service fact. If it is already connected, show that connected computer and
     do not create a new Prepare Session unless the user explicitly chooses
     `Set up again`.
   - The step is optional. The user may continue while setup runs or install a
     supported local agent later. Copy never asks about a generic "coding
     agent."
5. **Defaults — "Built into your OpenMeld setup" (Organization only)**
   - Untouched Organization memory and automatic Wake access default on and are
     presented as enabled. Existing explicit choices are preserved.
   - Organization brief is optional and explains that it gives Center Agent
     stable goals and operating context.
   - Information Protection is optional and visible only to an owner/admin.
     Ordinary members do not issue its read request.
6. **Invite — "Bring your teammates in" (Organization only)**
   - Owners/admins can send multiple member invitations and generate the
     Organization's reusable join link.
   - Email rows appear immediately as sending; partial failure rolls back only
     the failed row. A server-generated join-link token is never fabricated.
   - Members see concise read-only guidance and continue without friction.
7. **Ready**
   - Build a concise outcome list only from current confirmed facts: enabled
     Workspace memory, Channels, active Apps, this computer and enabled detected
     local agents, and pending invitations.
   - If nothing optional was connected, say setup is saved and name the next
     capabilities the user can add later. Never paint skipped work as
     connected.
   - Organization selection follows Workspace → Channels → Apps → This
     computer → Defaults → Invite → Ready.
   - Personal Workspace follows Workspace → Apps → This computer → Ready. Ready
     makes the default-on Workspace memory fact visible without adding another
     question. The progress indicator uses only those steps and never mounts
     team Channels, Organization policy, or invitation requests.
   - Organization and Personal copy remain distinct; neither path uses
     unexplained phrases such as `One shared loop`.

### Explicit New Space entry

`/o/:orgSlug/new-space` remains the explicit New Space entry from navigation
and empty states. It is not part of Setup Studio and does not gate product
entry. It continues to reuse the existing create/join Space paths and the
single membership owner.

## Web: In-Space Setup Guidance (the banner)

Placement: the right column of the Space view is the Members drawer (a
toggleable panel), and onboarding guidance does NOT live there. Setup
guidance is a dismissible banner at the top of the conversation area (the
main conversation), shown whenever the plan returns a non-done setup
decision for this user in this Space. It is never a full-screen takeover or
an empty-state that blocks the conversation: a Space used purely as a human
chat room must be one dismissal away from a clean conversation (Invariant 6).

The banner is plan-driven (one engine, Invariant 5), a container of per-row
dismissible CTAs (each row's × hides just that row; dismiss the last visible
row and the whole panel closes), and composed only from existing components
(see Web Implementation Constraints). In **Messages**, it overlays the top of
the conversation instead of consuming layout height and reuses the shared
`ProgressiveBlur` primitive used by the earlier-history loading treatment. The
overlay and action rows have no opaque background or structural border, so the
conversation remains visible behind the guidance. Controls still follow the
shared interface-shape token. The overlay does not cover **Graph** controls;
**Get set up** in the Space header returns the user to **Messages**. Dismissal
is session-scoped and never persisted — a refresh recomputes the plan and the
rows return; within a session the same header action brings them back (see
Behavior).

Two facts, two homes (Invariant 3 + the role rule, Invariant 8):

- The ordinary Space banner carries the coarse, act-now onboarding decisions.
  `bring_agents` acts in place (opens the Members panel);
  `connect_this_computer` routes to the centralized setup page. The banner
  never restates the connect command itself. The Center Agent Direct Message
  inline workflow is a separate host of the shared Connect flow, not an
  expansion of this banner.
- Per-member status — each agent's live Available / Offline / Unavailable —
  stays in the Members drawer badge (already shipped, read directly from
  `agentWakeAvailability`). The banner never restates wakeability.

Direct Messages use a narrower guidance policy. They never show
`bring_agents`, because adding a third participant changes the conversation
into a Space and belongs to the explicit conversion confirmation, not setup.
A human-human DM and a DM with somebody else's agent show no generic setup
guidance. A one-to-one DM with the current account's own local Agent Profile may
show only `connect_this_computer` when this computer is not connected, because
that action repairs the already-selected agent's execution path without
changing membership. The managed Center Agent counts as an agent for ordinary
Space setup completion, but its DM remains outside this local-computer rule.

Banner content by decision:

- `connect_this_computer` available — title "Connect this computer" (same copy
  whether or not the account has an agent yet); subtitle "So your local agents
  can reply when you mention them"; and a single "Connect OpenMeld Service" button
  that routes to the centralized setup page (the same destination as the Agents
  page). The OS-aware bootstrap command (macOS/Linux vs Windows toggle), the
  copy affordance, the command expiry + refresh, and the live "Waiting for this
  computer…" → "Connected" polling all live on that page — NOT inline in the
  ordinary Space banner. The banner does not dump a raw command into the
  conversation and does not offer web-side agent selection. The centralized
  setup page and the Center Agent Direct Message host reuse one Connect flow
  owner for the terminal handoff and live setup status while `openmeld setup`
  runs.
- `bring_agents` available — a single right-aligned "Add agents" control that
  opens the Members panel AND expands its "Add members" card, then flashes the
  card's border so a first-time user sees exactly where to act (it must not
  just open the drawer and strand them). The card is the shipped grouped-list
  selector backed by the shared profile-add planner in `packages/space`;
  building a second selector is forbidden — this is an entry point only.
- `bring_agents` done — a membership fact only: "<Agent> is in this Space".
  NEVER "can be woken" (Invariant 3). Whether it can be woken right now is
  the drawer badge; a member agent whose computer is offline shows Offline
  there, and the banner must not contradict that.
- `bring_agents` blocked (`agents.none_yet`) — the account has no agent yet;
  the meaningful action is `connect_this_computer` (its first agent is created
  by running `openmeld setup` on a connected computer). Do not show a dead "bring
  agents" affordance.

Replaces the old recovery split: coarse cases (no computer connected / no
agent) live in the plan-driven Get-set-up banner, acting in place. Fine-grained
per-agent recovery (a specific member agent whose controller is unchosen, off,
or disconnected) stays at the per-agent scope and can deep-link to the Agents
page when the fix belongs there.

Recovery-surface consolidation (landed): the computer/service-level
`review_computer` plan is removed from every per-agent surface and folded into
the Get-set-up banner. The single per-agent render point
(`SpaceAgentRecoveryActionControl`) returns `null` for `review_computer`, and
the old conversation-level `SpaceLocalAgentRecoveryBanner` is removed.
Computer-level "Connect this computer" is owned solely by the
Get-set-up banner, whose Connect action — when shown inside a Space — carries
`returnTo=space` + `spaceId` so completing setup returns to that Space. A Space
whose only affected agents are `review_computer` renders no per-agent recovery
surface; the agent still shows its live Offline badge (read from
`agentWakeAvailability`, never restated by the Get-set-up banner — Invariant
3/8). The remaining per-agent plans keep acting at their own scope:
`connect_controller` / `turn_on_controller` act in place; `choose_controller` and
`review_agent_profile` deep-link to the focused Agent Profile row on the Agents
page (`/app/agents?profileId=…`); `review_provider_account` links to the Agents
page root WITHOUT focus, because that page has no actionable provider-account
fix today and a focused row would be a dead end (focus is added only once a
provider-account fix exists there). The shared `prepareSetupHref` link is kept
for the `prepare_agent_profile` action and the Wake-failure `prepare_setup`
link, now shortened to `/app/connect?returnTo=space&spaceId=…` (the viewer is
resolved from the Space's last-used human profile on arrival). All of this is
navigation/display only — no liveness, readiness, or Wake routing fact changes.

Behavior:

- Dismiss/recall: each row's × hides just that row for the session; dismissing
  the last visible row closes the panel. Dismissal is never persisted, so a
  refresh re-derives the plan and the rows return (Invariant 4/6). Within a
  session a **Get set up** action appears in the Space header's right-aligned
  action group immediately before **Members** whenever there is available setup
  but every row is hidden, or while **Graph** is active and the Messages-only
  overlay is not visible. It never joins the **Messages** / **Graph** view row.
  Clicking it returns to **Messages** and restores the panel. Hidden state is
  presentation-only.
- Completion: when no setup decision remains, no banner renders — a clean
  conversation, nothing to collapse.
- Re-entry: recomputed from facts on every mount (Invariant 4); stale facts
  render with last-known values plus a refresh affordance, never a blank.
- New facts reopen the banner: if a previously connected computer goes
  permanently stale, the planner re-emits `connect_this_computer` and the
  banner reappears with only that action.

Copy baseline (English; renderers may localize later, meaning may not
drift):

| Element | Copy |
| --- | --- |
| Banner heading | `Get set up` / `Optional. Dismiss anytime.` |
| Connect (banner) | `Connect this computer` / `So your local agents can reply when you mention them` / button `Connect OpenMeld Service` (routes to the setup page) |
| Waiting status (setup page) | `Waiting for this computer…` |
| Connected status | `Connected` |
| Bring agents (available) | `Add agents` (opens + flashes Add members) |
| Bring agents (done) | `<Agent> is in this Space` (membership only — never "can be woken") |
| Dismiss / Recall | per-row `×` / header **Get set up** action |

Accessibility floor: the banner is a labeled region; status changes announce
via `aria-live`; dismiss/recall and every control are keyboard-reachable;
the banner is composed from shared `@openmeld/ui` primitives and any remaining
Web-local primitives that have not moved to the shared package. Apply the same
review bar the Members panel rework received.

## Web Implementation Constraints

- Reuse shared `@openmeld/ui`, Fluid, and shipped OpenMeld product components
  before adding a primitive. Setup Studio owns orchestration and layout, not a
  parallel Slack, App, invitation, Organization policy, or Prepare
  implementation.
- The visual language is restrained and high-contrast: quiet borders, compact
  type, limited accent color, containers that follow the shared interface-shape
  token, and generous whitespace. The right side may be richer, but animation
  must explain a real relationship rather than decorate an idle screen.
- Motion must support `prefers-reduced-motion`. Repeating SVG motion uses a
  small number of slow path indicators; it must not create layout work or
  prevent interaction. No autoplay video or animation is required to continue.
- Product copy and code use one stable term per concept: Organization, Channel,
  App, OpenMeld Service, Center Agent, Agent Profile, Codex, and Claude Code.
  Internal implementation words stay out of beginner copy unless they are the
  name of a real user-controlled component.
- All query keys keep unrelated payload shapes in separate key families.
  Optimistic Organization scope writes must never match invitation, App,
  Channel, or setup caches by prefix.
- The old `OrganizationEntryOnboardingDialog` and its hook/steps/tests are
  retired after Setup Studio lands. Reintroducing it would create a second
  onboarding state and is prohibited.

## First Release Boundary

Required for the first public release:

- account-wide first-entry gate and versioned resumable progress;
- existing/pending/create/join Organization paths;
- real Slack and Lark/Feishu connection status and actions;
- live OpenConnector catalog, OpenMeld-ready connections, and durable App
  requests with requester identity;
- embedded optional computer setup for Codex/Claude Code/Cursor/OpenCode;
- visible defaults, optional Organization brief, admin-only Information
  Protection;
- multi-email invitations, reusable join link, and a real fact-derived result;
- deterministic direct re-entry and local restart;
- optimistic writes with exact rollback, role branches, reduced motion,
  keyboard access, focused tests, build, and local browser smoke.

Deferred until after the first release:

- automatic requester notification when a requested App becomes available;
- onboarding analytics funnels, experimentation infrastructure, and remote
  configuration;
- videos, personalized generated demos, tutorial tours, templates, Playbooks,
  Routines, Skills, and advanced multi-Agent teaching;
- a server-synced completion record across browsers. Local account-scoped
  versioning is accepted while the product has only internal test users.

## CLI Surfaces

`openmeld start` — identity and Space entry only: sign in (or `--ott`), ensure
display name / first Human Profile, select or create an Agent Profile in Agent
View, and return explicit Space commands. When this computer needs local setup,
`start` points at `openmeld setup`; it never inlines machine setup itself and never
duplicates banner logic.

`openmeld setup` (human view) — owns local machine setup: service installation or
repair, local agent connection, readiness-facing setup checks, and
OpenMeld-managed skills. It renders the shared plan where applicable, executes only
what is missing, and is safe to run repeatedly; on a fully healthy machine it
prints the all-set line and exits 0. It remains the receiver of the Web
Prepare handoff (`--start-session <token>`) and the only human-facing
machine-state verb (Invariant 7).

When setup starts or verifies OpenMeld Service, its human-facing completion copy must
say that OpenMeld Service is running in the background, that it starts automatically
when the user signs in, how to disable that autostart, and how to stop the
service. Keep this copy concise and do not mention unreleased clients.

After successful setup, OpenMeld does not create a separate welcoming Agent
Profile or a setup-owned welcoming Space. The user's personal Center Agent owns
the first-touch onboarding conversation in the Center Agent DM. Setup completion
may still write a `setupBootstrap` record for cross-client compatibility, but the
retired welcoming fields are `null` for current runs. Legacy welcoming profiles
and Spaces are hidden from current lists and must not become a second entry point.

Local-agent discovery and connection are CLI concerns, not Web ones. In the
ordinary human flow, `openmeld setup` does not ask the user to choose local
agents. It automatically registers and enables each runnable built-in Agent
Controller the first time that controller is detected on this computer. A
controller that is already registered keeps its existing enabled state, so
re-running setup never reverses a user's explicit Computers setting. Explicit
automation may still narrow one setup run via `--local-agent <id>` or
`--local-agents all|none`.

The Web never selects agents and never drives a step-mirroring session; its only
handoff is a copyable command
(optionally carrying a one-time token that the terminal exchanges for the same
local CLI sign-in session as `openmeld login`) plus watching the connected fact flip.
The retired web selector and
stepper have no successor (see Retired Surfaces).

Setup reports the controllers it enabled, the controllers whose previous Off
state it preserved, and any per-controller attention still required. One
controller that needs sign-in, repair, or an install choice must stay unavailable
and visible without preventing another healthy controller from connecting.
Setup may report connected local agents and local readiness evidence. It does not
choose a managed welcoming profile, create Agent Profile Binding truth for
onboarding, or ask which local agent should run an onboarding assistant. Model
selection, Wake health, Binding repair, and profile execution management remain
Agent Profile management concerns.

`openmeld doctor --view agent` — default read-only planner twin plus diagnostics.
It emits `setup.plan` with `readOnly: true`, preserves the existing diagnostics
payloads, and performs zero setup mutations. `openmeld doctor --repair` remains an
explicit compatibility/manual repair path and is separate from the default
read-only planner output.

Agent view (`--view agent`) — both `setup` and `doctor` emit the decision
list as machine output:

- `setup.plan` result: `{ schemaVersion, readOnly, facts, plan: { decisions,
  summary } }`, codes snake_case per shared-contracts naming. The payload is
  validated by `packages/schemas` and reuses the onboarding facts and plan
  schemas instead of copying action shapes.
- The agent loop is: read the first executable decision from
  `plan.decisions`, run its command when present, rerun `openmeld setup --view
  agent`, repeat until `setup.complete` reports summary `nothing_to_do`.
- `doctor --view agent` emits the same payload with `readOnly: true` and never
  mutates on the default diagnostics path.
- Agent view requires explicit arguments and never prompts (existing house
  rule for Agent View).
- When setup reaches a recognized computer-level blocker, Agent View emits the
  shared `LocalMachineIssue` error event and Human View shows the same issue as
  one plain-language action. Setup stops immediate automatic retries for
  user-action blockers such as a full disk or macOS blocking background
  execution. After the user fixes the computer condition, the normal setup or
  reconnect action resumes the same flow; the product does not send users to a
  separate repair decision tree. The bounded exception is an orphaned setup
  lock from an older CLI: ordinary setup cannot remove that legacy lock safely
  during mixed-version rollout, so it says the old owner is gone and gives the
  exact `openmeld repair local-state` action instead of telling the user to wait
  for a process that no longer exists. Before running that explicit repair, the
  user must close every other OpenMeld command that could replace a legacy lock.
  The repair scans every local command lock in the current lane, rather than
  treating setup as a separate lock protocol.

## Retired Surfaces

The Account Setup Studio supersedes earlier first-entry experiments while
keeping explicit New Space entry at `/o/:orgSlug/new-space` and contextual
guidance in the Space conversation. The legacy `/app/start/*` corridor has
been deleted. The temporary `/app/start*` redirect shim has also been removed;
old `/app/start` links no longer bridge into the active flow. Routes removed:
every old child route — `with-agents`, `choose-space`, `create-space`, `join-space`
(+ `find-space`), `human-profile`,
`space-members` (+ `workbench`, `new-profile`), `bring-agents` (+ `computer`,
`prepare`, `agents`), `computer` (+ `agents`), `agent-cli`. With them retire:

- Corridor-only start-flow route memory (`start-flow-routes`) and child-route
  step state. The app-level `start-flow-state` / `start-flow-guard` helpers
  remain under the app owner where current Spaces and profile surfaces still use
  them.
- The legacy planner `plan-start-next-action` + `StartNextActionId` +
  `build-start-foundation-state` + `StartSharedState` has been deleted.
- Legacy StartSession write/read/handoff routes are fully removed. The old
  `/v1/start/*` and `/v1/start/session/handoff` paths now return a normal 404;
  the previous one-release 410 `start.session.retired` shim was deleted after
  the forced-update floor moved past every StartSession client. No StartSession
  route creates, reads, updates, or resumes onboarding state. The physical
  `openMeldDaemon_start_sessions` and `openMeldDaemon_start_session_tokens` tables have been
  removed by an explicit database migration.
- Legacy corridor prepare child pages and the Web local-agent selector
  (`setup-local-agent-selector`). The shared Connect flow keeps the prepare
  command, timeline, token refresh, and live PrepareSession stream and is hosted
  by both the Connect page and the first-party Center Agent Direct Message; agent
  selection now happens in Terminal during setup.
- The OS-picker-as-page; the OS choice survives only as a minimal toggle on
  the connect banner.
- The pre-join binding gate (`ensureSelectedAgentRuntimeBindingsForSpaceEntry`
  semantics) — the obsolete gate recorded in `space-collaboration.md` was
  closed by this retirement.
- `SpaceLocalAgentRecoveryBanner` — removed. Its coarse computer-level cases and
  `review_computer -> prepareSetupHref` bounce are folded into the Get-set-up
  banner; per-agent recovery remains scoped to member rows/details or the Agents
  page (Invariant 8).
- The temporary blocking Organization-entry onboarding dialog, its
  preference/connection steps, local transition state, and tests. Setup Studio
  now presents the same real settings in the account flow; Settings remains the
  ongoing management home.
- Corridor-only `clients/web/src/lib/start/*` helpers.

## State Machine Boundary

Account Setup Studio, the contextual planner, Web guidance, and CLI setup must
never recompute, own, write, or re-derive any runtime/readiness state-machine fact. That
system (cross-cloud + cross-local, heartbeat-driven, multi-layer) is hard
won and stable, and is owned entirely by Core and the daemon:

- Profile identity is owned by Auth; Binding by Core (D1 bindings);
  ServiceRuntime / lease / heartbeat (200s TTL) and route registration by the
  Core RuntimeTransportHub DO; in-flight Wake execution by RuntimeCoordinator;
  per-Agent-Profile readiness by Core's `AgentExecutionReadiness` (computed
  per request, projected as `agentWakeAvailability`:
  available / checking / offline / unavailable).
- The wizard is a pure presentation/orchestration layer above all of this.
  It consumes only coarse, already-computed projections: "is this computer's
  OpenMeld Service connected" (the live service status) and "is an agent a member
  of this Space" (membership — not readiness). It does not register sessions,
  heartbeat, hold leases or tokens, or compute readiness.
- Agent wake availability is NOT a planner input. The Space member badge
  renders it directly from the existing `agentWakeAvailability` snapshot.
  Any user-facing Wake availability must come from Core's
  `AgentExecutionReadiness` (AGENTS.md Source-Of-Truth), never re-derived in a
  wizard surface — Service is Service, Agent is Agent.
- Per-agent reply recovery (a member agent that cannot reply: controller
  unchosen, off, or disconnected) is readiness, not onboarding. It belongs
  to the Agents page and the drawer badge, never to the onboarding banner.
  The banner covers only the coarse milestones (connect this computer, set up
  first agent, bring agents membership).
- A change that makes a wizard surface read private daemon/Core state,
  recompute readiness, or merge agent wakeability into the computer fact is a
  boundary violation and must be rejected, even if it passes tests.

## Out of Scope

- Post-Studio tutorials, React tours, videos, templates, Playbooks, Routines,
  Skills, and advanced multi-Agent education.
- Automatic App-request availability notification. The request ledger retains
  enough requester and lifecycle data for a later backfill.
- Desktop Setup Studio. Desktop remains a future renderer and local management
  surface; it must reuse owning facts and the settled Web setup model.
- Organization/Space membership write semantics, Wake/readiness truth, and
  daemon lifecycle. This document owns their onboarding presentation, not
  their authority.

## Acceptance

The reviewer validates against this document. Verification gates (all must
pass; use the correct entries — `test` alone is a false green for
integration files in both openmeld-cli and clients/web):

| Gate | Command |
| --- | --- |
| Planner unit tests | `pnpm --filter @openmeld/start test` |
| Web unit | `pnpm -C clients/web exec vitest run --config vitest.config.ts` |
| Web integration | `pnpm -C clients/web exec vitest run --config vitest.integration.config.ts` (inherited red baseline only; no new reds) |
| CLI unit + integration | `pnpm --filter ./clients/openmeld-cli test` and `test:integration` |
| Typecheck / lint | affected packages `tsc --noEmit`, `biome check` |

Behavioral acceptance scenarios (each needs an automated test or a recorded
manual verification):

1. Fresh or existing account with no current-version completion opens any
   authenticated app route and enters Setup Studio. A completed account enters
   the requested product route without a flash of the Studio.
2. Organization choice covers an existing Organization, pending email
   invitation, new Organization, and reusable invite link. Each success
   continues in the resolved Organization; failure stays inline and restores
   the exact prior cache.
3. Owner/admin sees shared Slack/Lark and App actions. A member never mounts
   admin-only Information Protection or invitation reads and can continue
   through read-only status.
4. Slack and Lark/Feishu status is read from their existing owners. Closing an
   OAuth popup, a timeout, or an error cannot paint a connected outcome.
5. OpenConnector search reaches the live provider catalog. OpenMeld-ready Apps
   connect through their existing owner; other providers and free-form names
   create one durable requester-attributed request and remain requested after
   refresh.
6. This-computer setup shows Codex, Claude Code, Cursor, and OpenCode, emits a
   real one-time CLI command when setup is needed, follows Prepare progress, and
   may be skipped or left running without blocking Continue. Re-entry with an
   already connected Service shows the connected computer without issuing a new
   command.
7. Untouched memory and automatic Wake access become enabled. Existing explicit
   off choices remain off. Organization brief is optional; Information
   Protection is owner/admin-only and an empty value clears it.
8. Multiple invitation emails appear immediately. A partial server failure
   removes only failed optimistic rows and keeps successes. A reusable
   join-link URL appears only after Auth returns its real token.
9. Back, forward, refresh, and browser restart preserve presentation progress.
   Every returned control reconciles with current owning data instead of
   replaying old optimistic state.
10. `Skip setup` from every optional step completes the current version and
    returns to the originally requested feature in the selected Workspace, or
    to Center Agent chat when no valid feature return exists.
11. Direct onboarding re-entry and `?restart=1` reset only progress. Existing
    Organizations, Channels, Apps, requests, policies, documents,
    invitations, and local runtimes remain unchanged and visible.
12. The final screen uses Organization or Personal copy, shows only confirmed
    outcomes, and stays concise. A fully skipped flow says setup is saved rather
    than claiming integrations are connected.
13. Desktop-width UI is split left/right; small screens remain usable without
    the demo. Every control is keyboard reachable, progress is labeled, and
    reduced motion removes repeating SVG travel.
14. Contextual onboarding remains independent: Space membership never gates on
    local readiness; in-Space guidance and CLI setup continue to consume the
    pure planner; Setup Studio never writes RuntimeCoordinator, Binding,
    Service lease, or AgentExecutionReadiness truth.
15. CLI human and agent paths retain their existing contract:
    `openmeld setup` reaches all-set, `openmeld doctor --view agent` is
    read-only, and agent-view decisions remain deterministic and snake_case.
16. A user joins a Space on a computer without OpenMeld Service. Membership
    succeeds and remains visibly distinct from the non-blocking computer setup
    action; nothing presents the joined state as a failure.
17. The same account opens a second computer. Organization and Space membership
    remain intact while contextual guidance independently offers setup for that
    computer.
18. `bring_agents` opens the existing Members panel and its Add members surface.
    No parallel agent selector exists in onboarding.
19. The centralized Connect page and Center Agent Direct Message render the
    same setup command and live timeline owner. The page stays a page; the
    Direct Message stays inline; both reach the same verified completion state.
20. A human-only Space can dismiss all setup guidance to reach a clean
    conversation and recall it during the same session.
21. Completed `bring_agents` copy states membership only. If the Members drawer
    reports an agent Offline, no onboarding surface claims that agent can be
    woken.
22. An ordinary Space or external Message Channel routes computer setup to the
    Connect page. Only the first-party Center Agent Direct Message hosts the
    shared workflow inline. Computers remains the fleet management home.
23. Setup Studio and contextual Web onboarding follow the shared interface-shape
    token. Setup Studio cards, inputs, buttons, demo frames, icon containers,
    and contextual-banner controls use semantic radius utilities so Rounded uses
    the configured radius and Square resolves to `0px`. The contextual banner's
    progressive-blur overlay and borderless action rows are not card surfaces;
    tiny semantic status dots remain circular.
24. For a fixed planner fact fixture, the in-Space renderer, `openmeld setup`
    human output, and agent-view decision ids remain the same ordered list.
