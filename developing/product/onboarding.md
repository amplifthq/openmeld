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

## Web Tutorial

The default first-run entry is `/o/:orgSlug/onboarding`. The centered chooser
uses existing Personal Workspace, Organization creation, invitation acceptance,
and join-request flows. The former Setup Studio and demonstrations remain in
source for rollback but have no route, navigation, or Help entry.

Users create a real Space, add their Center Agent, and send a prepared greeting.
While it replies, they can connect a local agent through Members, Add people or
agents, and the existing New Agent flow. Computer setup remains optional.
After adding their local agent, they can send it a prepared greeting, then read
the Center Agent's reply and choose further configuration.
Starting prepares the designated Center Agent through its existing Core owner,
then reserves a run and Space identity. Only the user's normal Create action
creates that Space. Retries keep its identity. The suggested name is Welcome
to OpenMeld; Replay checks visible names and suggests a numbered suffix.
Continue resumes the saved Space. Earlier Spaces and messages remain intact.
Transitional entry and creation pages replace history to prevent accidental
recreation on Back. A restart URL never resets a run.

Core owns one presentation-progress record per person and Organization.
Account admission checks whether the person has started any run, so switching
Organizations does not force another tutorial. Existing and new users without a
new tutorial record receive this entry once, even if they completed the former
flow. Former browser completion markers remain untouched but do not suppress
the new tutorial. Explicit Space and message destinations preserve
their invitation continuation and normal authorization. A progress-service error
must not lock the user out of the product; the explicit tutorial offers a retry.

The existing picker preselects the designated Center Agent; only Add changes
membership. The shared welcome draft builder fills an editable greeting with a
real Wake mention. Existing text, attachments, replies, and sent messages prevent
insertion. Only Send publishes it. The accepted Center Agent message advances
to the optional local-agent choice without waiting for a reply. Replies do not
interrupt that choice or local setup. Connect an agent opens Members directly.
The picker preselects an existing local agent owned by the person; otherwise New
Agent is the primary action. Tutorial additions keep the picker open until the
observed membership advances saved progress, so the old Members instruction
does not flash during handoff. Members guidance remains until the person acts;
it is not a timed slide. Composer guidance highlights the editable draft
and Send control. Adding that person's local controller enables a prepared
local greeting; another person's or a hosted Agent does not satisfy this step.
Membership alone claims no readiness or execution success.

Reply review recognizes only a published final reply correlated to this person's
sent Wake. Streaming, failed, stopped, and unpublished streams do not count.
The existing conversation displays actual progress and failures. The person
chooses when to move on, including while a request is pending. No cached answer
or simulated reply substitutes for a real request.

Help exposes one Tutorial row below Documentation and the changelog. Continue
and Replay use accessible icon buttons, tooltips, and shared Fluid Hover.
Continue appears for an unfinished run. Pause saves the step; the first pause
briefly points to the bottom-left user menu and Help. Its close button dismisses
only the reminder and preserves saved progress. Configuration-page reminders
use the same location. Missing controls during loading are not a paused run.
Run identity and revision protect newer progress from stale tabs. Failed saves
offer Try again.

Tutorial dialogs have a top-right Close control. Closing pauses at the current
step; it does not complete or reset the run. Finish tutorial records completion.

Optional choices use responsive horizontal Fluid cards and stacked product logos:
Channels (Slack and Lark), Plugins (GitHub, Google Drive, Gmail), and Routines.
Personal Workspaces and ordinary members omit Channels. Members see only their
own Plugins and Routines. Owner/Admin also see a compact For your team section:
Invite people and Team context. These open existing invitation and Center Agent
settings pages. There is no separate admin tutorial. Role queries fail closed.
The guide never fetches restricted invitations, Information Protection, or team
policy for members. It preserves memory choices, protection rules, and connections.

React Joyride owns the spotlight and tooltip; native controls retain their focus
and modal behavior. Shared Fluid components own hover and reduced motion.
One footer uses visible buttons. Optional computer setup has Not now and Connect
an agent; optional choices have Finish tutorial. No guide action
auto-sends a message, adds members, or changes shared configuration.

The additive `/v1/organizations/current/first-work` GET/POST contract is shared
through `packages/schemas` and `packages/api-client`. Apply native PostgreSQL
migrations, then deploy Core and Gateway before Web. Roll Web back before removing
the receiver. Older Web, CLI, Service, and Skills do not call it; setup, Wake,
and runtime epochs remain unchanged. Historical D1 imports leave this
PostgreSQL-only presentation table empty.

The local greeting and reply-review steps add `local-task` and
`review-replies` to the shared progress contract. Core and Gateway must accept
these values before the updated Web writes them. The text column needs no
migration. Earlier Web builds cannot parse these new saved values: refresh old
tabs, and retain these schema readers when rolling back presentation changes.
Do not roll Core/Gateway back to readers that reject existing progress records.
CLI, Service, Skills, setup, and Wake contracts are unchanged.

## Product Role

The standalone Connect Computer page remains available even when the account has
a connected computer. A compact, named computer summary links to management; it
does not assert that the computer hosts the current browser. Chat setup entry
points offer this management path before starting another setup, except for a
targeted computer or Agent recovery, explicit reconnect, or Service update request. All hosts retain the same Prepare
session workflow and source-specific completion actions. Instruction illustrations
explain user actions, never simulate connection or Agent readiness.

OpenMeld has two complementary onboarding layers:

1. **Tutorial** is the Web first-run entry: choose a workspace and complete
   one small real Space interaction before optional configuration.
2. **Contextual guidance** offers the next useful action on the current surface.
   Space empty states, in-Space banners, and CLI setup/doctor consume the existing
   pure planner independently of tutorial progress.

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

Trust-first Slack onboarding freezes the optional language observed by the
same accepted Center Agent member-research task that produces the Profile
Report. Core uses that frozen observation for the deterministic welcome and
its action labels; it does not reclassify the generated report or scan the
welcome text. When the task has no clear observation, Core falls back to the
Organization working-language preference and then English. The shipped
deterministic copy catalog supports English, Simplified Chinese, and
Traditional Chinese; an unsupported tag falls back to English. Later Slack
replies remain ordinary Agent decisions and follow the current DM, thread, or
channel even when it differs from the onboarding language.

The two layers deliberately have different state:

```text
Tutorial:
Core-owned per-person, per-Organization presentation progress
  + Auth/Core/Gateway real facts
  -> workspace chooser and guided real Space

Contextual guidance:
auth/profile/membership/device facts
  -> buildOnboardingPlan (packages/start, pure)
  -> Web banner, openmeld setup / doctor, agent-view JSON
```

Progress cannot grant membership or assert connection, identity, policy,
execution, or readiness. The shared CLI/Prepare renderer and copy remain in
their existing owners, including `packages/start/presentation/setup-flow-copy.ts`.

## Welcome Space Tutorial

The optional **Welcome Space tutorial** is a presentation layer over an ordinary
Space, shared by Desk and the full Space page. Its single path is: understand
Space, add people or agents through the existing member selector and New Agent
flow, then send an editable greeting to those members. New Welcome Spaces contain
only their creator. Center Agent is recommended and preselected on the first
Welcome picker opening, but membership changes only after Add selected. The user
can deselect it, create another Agent, or add both. Ordinary Spaces never inherit
that preselection. Existing Welcome members are preserved. Center Agent follows
the same collaboration path as any other Agent. One dashed
action card presents the next action; creating a local agent continues to use
the existing computer setup flow. No tutorial code derives readiness or sends
messages automatically.

The browser-local marker identifies a tutorial independently of its Space name.
It remembers completion and draft recipient IDs, but active membership,
names, permissions, and readiness come from their existing owners. Only a real
reply from an added Agent completes the collaboration step. Removing recipients
or clearing a draft leaves a usable next action. Ordinary Space guidance is
unchanged. No tutorial controls are exposed. Users hide and restore Welcome
Spaces through the same Desk window controls as other Spaces; hiding never
changes membership or deletes messages. Legacy paused progress resumes.

## Product Invariants

1. **A real result before more configuration.** Start with a small Space task
   and a real Center Agent reply. Optional computer, Plugin, Channel, Routine,
   and team settings keep their existing product homes.

2. **Low friction is a product requirement.** Every step after Workspace
   selection is optional. The user may skip the whole flow, continue while
   computer setup runs, and move backward without losing completed work. No
   optional integration failure may trap the user.
3. **Real facts, never onboarding copies.** A valid invitation-request link
   identifies an Organization; it does not prove membership or permission to
   join. Tutorial submits the existing invitation request, shows its pending
   outcome and status link, and keeps workspace selection available. It never
   optimistically adds membership for an approval request. Direct administrator
   links instead show Join and use Auth's membership writer before advancing.
   Both entry points read the stored link mode; a successful preview alone never
   proves membership. Organization
   membership, Channels,
   Apps, App requests, local runtime inventory, Organization memory, Wake
   access, Organization documents, Information Protection, and invitations
   remain owned by their existing Auth/Core/Gateway contracts. Tutorial
   reads and mutates those same facts.
4. **Presentation progress is allowed; product truth is not duplicated.**
   Core owns tutorial progress. Legacy local completion is read-only. Resume
   reconciles current membership, replies, and permissions. Contextual guidance
   stores no tutorial step and recomputes from current facts.

5. **Permissions shape the flow.** An owner/admin may connect shared
   Organization capabilities, invite members, edit the Organization brief, and
   edit Information Protection. A member sees only their own guidance, may use
   supported personal connections, and never mounts unauthorized read or write
   requests.
6. **Every mutation is optimistic where a truthful provisional state exists.**
   Update the owning query cache immediately and roll back the exact affected
   value on failure. When a server-generated secret is unknowable in advance
   (for example a new invite-link token), show an immediate pending outcome
   while retaining the last confirmed value; never invent a token or success.
7. **Preserve defaults and explicit choices.** Untouched Workspace memory
   defaults on; an existing off choice remains off. Authorized people manage
   these preferences in Center Agent settings. The tutorial never resets them.
   Agent Profile Organization ownership is not an onboarding question.

8. **Separate membership, Service, and wakeability.** Joining an Organization
   or Space, connecting this computer, detecting Codex, and proving an Agent
   Profile can currently be woken are separate facts. Tutorial may summarize
   only the facts it actually reads; it never derives Wakeability from a
   connected Service.
9. **One management home after onboarding.** Tutorial is a guided entry to
   existing mutations. Channels, Apps, People, Agents, Settings, Computers, and
   Documents remain their ongoing management homes. The old Organization-entry
   onboarding dialog is retired; two onboarding surfaces must not compete.
10. **Concrete language.** User copy says Slack,
    Lark, GitHub, Codex, Claude Code, or Antigravity instead of internal
    categories such as "coding agents." Each recommendation names a real action.
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
15. **One setup workflow, adapted to its host.** Tutorial, the centralized
    Connect page, and the Center Agent Direct Message reuse the same command,
    expiry, Prepare Session, update verification, and completion owner. Setup
    Tutorial opens it without its own completion actions. A generic Space banner
    links to the Connect page; a first-party Center Agent Direct Message may
    host the workflow inline; Slack and Lark receive the authoritative
    Connect-page action. Different hosts may change presentation, never setup
    semantics, copy ownership, or state machines.
16. **A brief Terminal disconnect recovers in place.** The CLI keeps the same
    Prepare Session and retries during the shared bounded reconnect window.
    Web shows reconnecting during that window and asks for a fresh command only
    after recovery does not converge, the command expires, or a real blocker
    requires a new handoff. A transient socket close is not user action.
17. **The copied command is fresh.** Prepare and Computer authorization
    credentials remain short-lived, but the Web surface automatically replaces
    an expired command and the Copy action refreshes before copying. The user is
    never asked to diagnose token expiry or manually reload the page to obtain
    a valid command.
18. **A temporary download interruption recovers inside the same command.** The
    setup bootstrap retries manifest and CLI artifact downloads within a small,
    bounded window and discards partial output before each retry. One incomplete
    transfer must not make the user copy or run the setup command again.

## The Start Planner (`packages/start`)

This planner owns contextual setup decisions after product entry. It does not
sequence Web tutorial, because Organization/Channel/App/invitation
choices are Web orchestration over their own live owners rather than
cross-client setup decisions. A rule used by both contextual Web guidance and
CLI setup still belongs in this planner; a Tutorial-only presentation step
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

Wakeability ("can this agent be woken right now":
available / checking / offline / unavailable) is deliberately NOT a planner
input. It is the Space member badge's job, rendered directly from the
existing compatibility `agentWakeAvailability` snapshot — Service is Service, Agent is
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
- Zero Agent Profiles: emit `bring_agents` as blocked with
  `agents.none_yet`. This preserves the real missing membership step without
  pretending an existing Agent Profile can be selected. Web may route that
  decision into the existing Members flow, where the user can create an Agent
  Profile, while `connect_this_computer` remains the independent computer
  setup action whenever it is also needed.
- Has Agent Profiles, this computer not connected: `bring_agents` and
  `connect_this_computer` are both meaningful and independent; emit both,
  neither blocking the other.
- Pinned by the Complete/Honest property tests above: the zero-agent fact
  fixture must not yield `bring_agents`; the has-agents fixture must.

## Web: Tutorial Entry

The stable onboarding route opens the workspace chooser. Legacy
`experience=first-work` and `restart=1` links do not reset a run.
Workspace choice resumes saved progress; Help > Tutorial > Replay explicitly
reserves another run. Create and join use existing Auth mutations, truthful
optimistic scope updates, and exact rollback. A join request never proves
membership before approval.

Explicit invitations retain the requested Space and subsequent app navigation.
Notification permission remains a separate non-blocking introduction after
normal product entry and requires the person's explicit gesture.

The chooser is centered. The guide operates on real Space controls and existing
configuration pages. Keyboard focus, native dismissal, small screens, and reduced
motion remain usable without simulated data or demonstration pages.

### Explicit New Space entry

`/o/:orgSlug/new-space` remains the explicit New Space entry from navigation
and empty states. It is not part of Tutorial and does not gate product
entry. It continues to reuse the existing create/join Space paths and the
single membership owner.

## Web: In-Space Setup Guidance

Placement: the right column of the Space view is the Members drawer (a
toggleable panel), and onboarding guidance does NOT live there. An ordinary
Space with no messages presents the plan's available setup actions as centered
Fluid action cards in the conversation canvas, directly below a plain-language
explanation of what a Space is. The composer remains available, so the cards
never gate a human-only conversation. Once the Space has a recorded message,
any remaining setup actions move to the existing dismissible banner at the top
of the conversation area. Empty-state cards and the banner are two renderings
of the same planner decisions and action handlers, never separate setup state.

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
is a browser-local presentation preference scoped to the account, Organization,
and Space. Refreshes and browser restarts retain it; the header action brings
the rows back (see Behavior). Dismissal never stores or overrides setup facts.

Two facts, two homes (Invariant 3 + the role rule, Invariant 8):

- The ordinary Space guidance carries the coarse, act-now onboarding
  decisions. `bring_agents` acts in place (opens the Members panel);
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

Empty-Space action cards:

- The centered introduction is `A Space is where people and agents work
together.` followed by `You and your teammates can give agents work. Agents
can ask other agents for help. Everyone can see the results here.`
- `Connect this computer` explains `Make Codex, Claude Code, or another local
agent available in OpenMeld.`
- `Add people or agents` explains `Choose people or agents for this Space, or
create a new agent.` It opens the existing Members panel and expands its Add
  members card; when no Agent Profile exists, that existing flow supplies
  Create Agent. The empty state never builds a second selector or
  agent-creation workflow.
- Both actions render when both planner decisions remain meaningful. Completing
  either action leaves the other available; after the first recorded message,
  that remaining action is presented by the dismissible banner.
- The cards use the shared `FluidCardGroup` / `FluidCardItem` primitive. Their
  content stays transparent so the single shared hover and delegated-focus
  background can move between cards, including the primitive's reduced-motion
  behavior.

Banner content by decision:

- `connect_this_computer` available — title "Connect this computer" (same copy
  whether or not the account has an agent yet); subtitle "So your local agents
  can reply when you mention them"; and a single "Connect Computer" button
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
  opens the Members panel and its "Add members" dialog so a first-time user
  lands directly on the action (it must not just open the drawer and strand
  them). The dialog is the shipped grouped-list selector backed by the shared
  profile-add planner in `packages/space`;
  building a second selector is forbidden — this is an entry point only.
- `bring_agents` done — a membership fact only: "<Agent> is in this Space".
  NEVER "can be woken" (Invariant 3). Whether it can be woken right now is
  the drawer badge; a member agent whose computer is offline shows Offline
  there, and the banner must not contradict that.
- `bring_agents` blocked (`agents.none_yet`) — the account has no agent yet;
  show `Add your first agent` with the existing Create Agent launcher. In the
  empty Space presentation, `Add people or agents` opens the Members flow
  instead, where the same creation path is available. Neither presentation
  shows a dead selector.

Replaces the old recovery split: coarse cases (no computer connected / no
agent) live in plan-driven Space setup guidance, acting in place. Fine-grained
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

- Empty Space: action cards are not dismissible and do not obscure the composer.
  Sending the first message replaces them with the conversation timeline and
  moves any remaining setup decision into the banner.
- Dismiss/recall: each row's × hides just that row for this account and Space in
  the current browser; dismissing the last visible row closes the panel.
  Local storage retains these preferences across refreshes, tabs, and browser
  restarts without storing readiness facts. Clearing browser storage resets
  them; blocked storage still permits dismissal for the current page.
  A **Get set up** action appears in the Space header's right-aligned
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

| Element                     | Copy                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty Space title           | `A Space is where people and agents work together.`                                                                                             |
| Empty Space description     | `You and your teammates can give agents work. Agents can ask other agents for help. Everyone can see the results here.`                         |
| Empty Space connect action  | `Connect this computer` / `Make Codex, Claude Code, or another local agent available in OpenMeld.`                                              |
| Empty Space add action      | `Add people or agents` / `Choose people or agents for this Space, or create a new agent.`                                                       |
| Banner heading              | `Get set up` / `Optional. Dismiss anytime.`                                                                                                     |
| Connect (banner)            | `Connect this computer` / `So your local agents can reply when you mention them` / button `Connect Computer` (routes to the setup page) |
| Waiting status (setup page) | `Waiting for this computer…`                                                                                                                    |
| Connected status            | `Connected`                                                                                                                                     |
| Bring agents (available)    | `Add agents` (opens the Members panel and Add members dialog)                                                                                   |
| Bring agents (done)         | `<Agent> is in this Space` (membership only — never "can be woken")                                                                             |
| Dismiss / Recall            | per-row `×` / header **Get set up** action                                                                                                      |

Accessibility floor: the banner is a labeled region; status changes announce
via `aria-live`; dismiss/recall and every control are keyboard-reachable;
the banner is composed from shared `@openmeld/ui` primitives and any remaining
Web-local primitives that have not moved to the shared package. Apply the same
review bar the Members panel rework received.

## Web Implementation Constraints

- Reuse shared `@openmeld/ui`, Fluid, and shipped OpenMeld product components
  before adding a primitive. Tutorial owns orchestration and layout, not a
  parallel Slack, App, invitation, Organization policy, or Prepare
  implementation.
- The visual language is restrained and high-contrast: quiet borders, compact
  type, limited accent color, containers that follow the shared interface-shape
  token, and generous whitespace. Animation must explain a real relationship rather than decorate an idle screen.
- Motion must support `prefers-reduced-motion`. Motion must not create layout work or prevent interaction. No autoplay video or animation is required to continue.
- Product copy and code use one stable term per concept: Organization, Channel,
  App, OpenMeld Service, Center Agent, Agent Profile, Codex, and Claude Code.
  Internal implementation words stay out of beginner copy unless they are the
  name of a real user-controlled component.
- All query keys keep unrelated payload shapes in separate key families.
  Optimistic Organization scope writes must never match invitation, App,
  Channel, or setup caches by prefix.
- The old `OrganizationEntryOnboardingDialog` and its hook/steps/tests are
  retired after Tutorial lands. Reintroducing it would create a second
  onboarding state and is prohibited.

## First Release Boundary

The replacement requires the native progress migration, receiver-first rollout,
default-entry cutover, legacy admission, fresh Organization Center Agent bootstrap,
idempotent creation, saved pause/resume/replay, stale-tab protection, role filtering,
and a correlated first reply. Validate Owner, Admin, member, and Personal states;
fresh and existing Organizations; Back/refresh; and explicit invitation entry.

Configuration keeps the existing permission owners and product pages.
The contextual CLI planner is unchanged. Analytics, generated demonstrations,
and a separate admin tutorial are outside this release.

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

Successful Human View completion stays focused on the user outcome: this
computer is connected, the truthful local-agent result, and one link back to
OpenMeld Web. Its mode-independent title is `Computer connected`; it does not
guess Setup versus Update from an existing Computer id, which can also represent
a reconnect. The body says `Your computer is connected.`, not that the whole
computer is ready, because local agents may still be syncing, absent, or need
attention. It uses one sentence per line with blank lines between sentences.
CLI and Service versions, running state, autostart controls, and stop commands
belong to `openmeld service status`, not the success summary. A failed or partial
completion still names the reason and one recovery action.

Important completed Human View setup steps retain the existing progress history
and add one presentation-only timestamp and elapsed duration:
`[HH:mm:ss] ✓ Result · elapsed`. `HH:mm:ss` is the zero-padded 24-hour local
time of the computer running the CLI. Active spinner and internal detail lines
remain untimestamped. Timing does not participate in setup decisions or change
execution, waiting, or Service lifecycle ordering.

When a healthy running Service only needs a newer version, Setup must hand the
prepared update to the computer's background update worker without waiting for
current Agent work to end. That handoff says the update started in the
background; it is not Setup completion. Setup or Prepare may report success only
after the operation is `updated` and both the exact target CLI and Service are
observed. `restored` and `needs_help` remain explicit failures with one next
action. The user may close Web Setup or the Terminal after handoff and rerun
Setup after the background operation finishes. Setup must not use this path to
hide a broken or ambiguous Service. A background update does not make Setup the
owner of Wake completion or final Agent readiness.

A newly connected computer keeps OpenMeld Tools up to date by default. This is
a saved computer preference, not a condition for completing Setup. Turning it
off stops ordinary automatic requests but never removes the direct Update
action or the explicit reconnect/CLI recovery path. After the Computer is
connected, its OpenMeld Tools card shows **Keep OpenMeld Tools up to date** so
the member can change the default without learning Service or CLI concepts.

After successful setup, OpenMeld does not create a separate welcoming Agent
Profile or a setup-owned welcoming Space. The user's personal Center Agent owns
the first-touch onboarding conversation in the Center Agent DM. Setup completion
may still write a `setupBootstrap` record for cross-client compatibility, but the
retired welcoming fields are `null` for current runs. Legacy welcoming profiles
and Spaces are hidden from current lists and must not become a second entry point.

Local-agent discovery and connection are CLI concerns, not Web ones. In the
ordinary standalone human flow, `openmeld setup` does not ask the user to choose
local agents. It automatically registers and enables each runnable built-in
Agent Controller the first time that controller is detected on this computer.
During an ordinary Web computer handoff, OpenMeld Service connects first and
the command may finish while controller discovery continues in the Service's
background catalog refresh. A controller installed later is discovered without
another setup command. A controller that is already registered keeps its
existing enabled state, so setup and background refresh never reverse a user's
explicit Computers setting. Explicit automation may still narrow one setup run
via `--local-agent <id>` or `--local-agents all|none`.

Standalone Setup uses the same registration reconciliation as the Web handoff
and background discovery. Its observed runnable list is not a replacement for
the saved Local agents switches: only an explicit selection may turn unselected
controllers off. A registered controller excluded from automatic selection
keeps its saved state. When all selectable controllers were deliberately turned
off, completion explains that choice instead of showing an installation guide.

The ordinary Web handoff represents that background catalog refresh with an
empty terminal selection. Human completion must present that state as local
agents syncing in the background. It must not reinterpret the empty selection
as proof that no supported local agent is installed or show the installation
guide. Standalone Setup may show the guide only after its own discovery found
no supported local agent.

When more than one verified installation can provide the same controller,
setup stays non-blocking. It first honors an existing saved choice; otherwise
it uses the installation resolved first from the user's current terminal PATH
and saves that launch contract. Setup reports the controller as connected, not
merely detected. After setup, the computer owner may inspect every currently
verified installation and change the saved choice from that Computer's Local
agents section. This is an owner action on one computer; it does not create a
second Agent Profile or another controller identity.

The Web never selects agents and never drives a step-mirroring session; its only
handoff is a copyable command carrying a short-lived, browser-approved Device
Authorization grant that creates an independent Computer session for the same
user, plus watching the connected fact flip.
The retired web selector and
stepper have no successor (see Retired Surfaces).

Setup reports the controllers it enabled, the controllers whose previous Off
state it preserved, and any per-controller attention still required. One
controller that needs sign-in or repair must stay unavailable and visible
without preventing another healthy controller from connecting.
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

The Web tutorial supersedes earlier first-entry experiments while
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
  preference/connection steps, local transition state, and tests. Tutorial
  now presents the same real settings in the account flow; Settings remains the
  ongoing management home.
- Corridor-only `clients/web/src/lib/start/*` helpers.

## State Machine Boundary

Web tutorial, the contextual planner, Web guidance, and CLI setup must
never recompute, own, write, or re-derive any runtime/readiness state-machine fact. That
system (cross-cloud + cross-local, heartbeat-driven, multi-layer) is hard
won and stable, and is owned entirely by Core and the daemon:

- Profile identity is owned by Auth; Binding by Core (relational Binding records);
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
- Wakeability is NOT a planner input. The Space member badge renders it directly
  from the existing compatibility `agentWakeAvailability` snapshot. Any
  user-facing Wakeability must come from Core's projection, currently exposed
  through `AgentExecutionReadiness`; a wizard never re-derives it — Service is
  Service, Agent is Agent.
- Per-agent reply recovery (a member agent that cannot reply: controller
  unchosen, off, or disconnected) is readiness, not onboarding. It belongs
  to the Agents page and the drawer badge, never to the onboarding banner.
  The banner covers only the coarse milestones (connect this computer, set up
  first agent, bring agents membership).
- A change that makes a wizard surface read private daemon/Core state,
  recompute readiness, or merge agent wakeability into the computer fact is a
  boundary violation and must be rejected, even if it passes tests.

## Out of Scope

- Videos, templates, Playbooks, Routines,
  Skills, and advanced multi-Agent education.
- Automatic App-request availability notification. The request ledger retains
  enough requester and lifecycle data for a later backfill.
- Desktop Tutorial. Desktop remains a future renderer and local management
  surface; it must reuse owning facts and the settled Web setup model.
- Organization/Space membership write semantics, Wake/readiness truth, and
  daemon lifecycle. This document owns their onboarding presentation, not
  their authority.

## Acceptance

Use focused affected-package type, lint, behavior, and integration checks;
real browser smoke proves only the paths actually exercised.

1. First entry opens the centered workspace chooser. Legacy completed users
   and accounts with a run in another Organization enter the requested product.
2. Explicit Space invitations retain their destination and access gate.
3. A fresh Organization can add its designated Center Agent without first
   opening a Direct Message.
4. Center Agent is preselected, but membership changes only on Add.
5. The draft has a real Wake mention. Only Send publishes it; only a correlated
   final Center Agent reply advances it.
6. Back, refresh, retries, stale tabs, Continue, and Replay preserve their
   declared Space identities and saved progress.
7. Ordinary members see no Channels or team administration guidance, and mount
   no restricted policy or invitation reads. Owner/Admin see existing team
   configuration entries. Personal Workspaces omit Channels.
8. Optional Agent setup uses the existing computer and Prepare owners.
   Local membership is distinct from connection, Wakeability, and execution.
9. Pause, Help Continue/Replay, error retry, keyboard operation, and small-screen
   layout remain usable. Shared Fluid components preserve reduced motion.
10. Optional configuration never claims success from navigation or clicks.
    Memory preferences and existing shared settings remain unchanged.
11. Contextual Web guidance and CLI setup/doctor retain the pure planner and
    their existing contract. No tutorial derives or writes runtime state.
12. Native migrations and additive receivers precede the Web caller. Production
    release and final-candidate checks remain separate from local screenshots.
