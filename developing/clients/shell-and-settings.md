# Unified Shell + Single Settings — shared primitives and historical baseline

## Agent Context

- Purpose: Define the shared shell/Settings primitive boundary and preserve the
  historical Web/Desktop baseline. Current Web navigation and Settings
  placement are owned by `developing/clients/web.md`.
- Read this when: You are changing shared shell composition, Settings
  information architecture, shell/sidebar terminology, Settings capability
  gating, or cross-client shell/Settings primitives.
- Update this when: Web or Desktop changes the app shell model, Settings
  taxonomy, shell/Settings ownership, or shared shell/Settings primitive
  contract.
- Do not use this for: Runtime truth, readiness authority, Wake execution,
  Binding ownership, OpenMeld Service lifecycle, client-specific data wiring, or
  one-off visual polish.
- Source of truth: This file owns shared cross-client shell and Settings
  primitives. `developing/clients/web.md` owns current Web navigation and
  Settings placement; `developing/clients/desktop.md` owns Desktop product
  placement. Architecture facts remain owned by the scoped
  `developing/architecture/` documents.

## Current scope

The shared primitives remain active while Web placement is delegated. The
original 2026-06-22 Web destination list was superseded by the 2026-07-13
W-NAV target.
This document now summarizes that target only to explain the shared shell; when
placement or route details differ, [web.md](web.md) is authoritative. The
shared Sidebar/Settings primitive guidance and architecture guardrails remain
active; Desktop placement is decided by [desktop.md](desktop.md).

## 1. Goal and current owner

Current Web uses the fixed
76px **Center Agent / Spaces / Team** application rail, with a separate
**New Agent** creation action and contextual lists in a collapsible middle column.
**Settings** remains a separated utility. **Projects**, **Documents**, and **Agent
Activity** retain their routes and product surfaces but are temporarily hidden
from this rail. The bottom toolbar puts
the signed-in member's current **Computer** at the far-left edge of the inset
content column and keeps **Center Agent / Inbox** together at the far-right
edge, and
the **Personal / current Organization name** Settings groups defined in
`developing/clients/web.md`. Center Agent uses the shared Spaces list; **Messages /
Graph / Files / Routines / Skills / Channels** live in its header, while
**Memory** lives in its compact header menu. Center Agent settings lives in
the global App Settings destination.

The Web application rail places the Organization selector above compact history,
search, and Inbox controls. The work-area header toggles the middle column. Its
footer uses the Fluid user dropdown with account switching, Settings, and Log out entries,
plus adjacent Settings and theme controls. Authentication, history, and theme
ownership remain in the existing Web hooks and router.

One shell and one Settings framework let Web and the Electron GUI reuse shared
pieces without forcing two clients to keep an obsolete route map. Current Web:

- keeps **Center Agent / Spaces / Team** as the fixed
  visible product destinations, temporarily omits **Projects / Documents /
  Agent Activity** without relocating them, separates Settings as a utility,
  and opens the current Computer, Center Agent, and Inbox from the app canvas's
  global toolbar;
- uses one Settings destination with stable **Personal** and dynamically named
  current Organization groups;
- places **Plugins** after **People** and **Agents** in Team, with separate
  personal and named Organization configuration;
- makes Team the people directory, with each person's Computers and Agent list
  reached through their Human Profile detail;
- keeps Service preferences capability-gated for hosts that can own local-service
  controls; Service is not a Web top-level sidebar item;
- gives every active app view one persistent outer app rail and content
  surface, with a resize-only contextual inner sidebar only for route families
  that own one; and
- shares the Sidebar primitive family and Settings primitives through
  `packages/ui`, with Web adopting first and Desktop reusing the same injected
  contracts later.

Long-term the GUI may become the primary surface (Space ports into Desktop
later); Web becomes the online version of the same app.

## 2. Owner-doc compliance

**Acceptance (CLAUDE.md hard rule): this taxonomy does NOT violate the owner
documents under `developing/architecture/`.** A 4-reader validation (one per owner
doc) converged on CLEAN-WITH-WORDING — no structural violation of the liveness /
availability / Wake-routing / binding / service-lifecycle fact model. The only
owner-doc-touching change would be the optional runtime rename, which we
deliberately do NOT take (see [§3](#3-settings-taxonomy)). The UI adopts the
following canonical terms and hard constraints:

**Canonical terms (use these in user copy):**

| Concept                                                                                          | UI copy                                                             | Reserved for diagnostics/schemas                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The local service daemon                                                                         | **OpenMeld Service**                                                | `ServiceRuntime` (internal durable record)                                  |
| The agent program on a machine (Codex / Claude Code / Grok Build / Cursor / OpenCode / OpenClaw) | **local agent** (+ its product name)                                | `Agent Controller` (execution of one Agent Profile)                         |
| An account-level agent identity (name/model/reasoning)                                           | **Agent**                                                           | `Agent Profile`                                                             |
| "Which machine runs which agent"                                                                 | "**Agent X runs on Computer Y**" / "Use this agent on this machine" | `Binding` (`Agent Profile → openMeldServiceRuntimeId + agentControllerRef`) |
| Service liveness                                                                                 | **Connected** / **OpenMeld Service is running**                     | heartbeat-fresh `ServiceRuntime`                                            |
| Agent Wakeability                                                                                | **Available / Checking / Offline / Unavailable**                    | compatibility readiness and availability projection states                  |

We keep **local agent** (not "agent runtime"): "agent runtime" appears zero times
in the owner docs, and `Connect local agent` is a **shipped, owner-doc-protected
Local Components Manifest action label** (shared-contracts.md:118,
agent-transport-contract.md:449) that CLI users already see. Renaming would force
amending that published string. `Connected` as a liveness label IS owner-doc
sanctioned (agent-transport-contract.md:408/414).

**Hard constraints the UI must respect:**

1. **Liveness is the single source of truth.** A Computer's "Connected/online"
   reflects ONLY `ServiceRuntime` heartbeat freshness within TTL. Never conflate
   with binding existence, Wake-route availability, or execution readiness.
2. **Read paths must not probe.** The UI reads Core-owned projections
   (`ServiceRuntime` heartbeat, `AgentWakeRouteRegistration` /
   `AgentExecutionReadiness`, expected-routes). It never pings the local daemon to
   infer liveness or availability.
3. **Three orthogonal signals, never substituted:** (a) Computer online =
   heartbeat fresh; (b) Agent Wakeability `Available` = Core projection; (c)
   Agent bound to this Computer = a Binding exists. Service health is NOT product
   readiness — never derive a green "agent can reply" from service status alone.
4. **Wakeability verdicts are Core-owned** — render `Available / Checking /
   Offline / Unavailable`, sourced from the projection; never synthesized from
   service health or binding presence.
5. **Diagnostic data must not pollute availability.** EvidenceSyncHealth, stale
   controller reports, aged/progress evidence, evidence freshness are
   diagnostic-only — never availability/readiness blockers, never in public badges.
6. **Status surfaces are read-only.** Status displays never silently
   start/stop/repair/reinstall/toggle. Explicit user-visible actions only.
7. **Setup action labels come from the Local Components Manifest** (`Connect
Computer`, `Reconnect Computer`, `Update OpenMeld on Computer`, `Connect local agent`,
   `Update OpenMeld skills`, `Everything is up to date`) — never invented copy like
   "Service not running". Status (Running/Stopped/Not installed) is a SEPARATE
   concern from the manifest action label — show both; never infer the action from
   status alone.
8. **RuntimeCoordinator internals are forbidden from user UI** (fencing token,
   retry counts, lease TTL, watchdog flags, timeouts, in-flight progress) —
   diagnostics/trace only.
9. **Wake / Reference are Space message semantics**, not OpenMeld transport
   configuration — they do not appear as user-configurable settings.
10. **Code-level:** Agent Controller refs (`builtin:<id>`/`custom:<id>`) and OpenMeld
    Service Runtime IDs are built/parsed via `packages/agent-runtime` shared
    helpers (opaque, authoritative) — never hand-built from owner/device/lane
    strings in UI code.
11. **Provenance + viewer visibility:** if Profile/connection details are
    rendered, each field carries source provenance and owner-self-vs-observer
    visibility, determined BEFORE fetching. Owner-self may see controller
    conversation/runtime IDs, computer, model, Binding state; observers must not.
12. **Failure copy** uses `packages/schemas/src/public-agent-failure-reason.ts` and
    parses CLI JSON via `cliJsonOutputEnvelopeSchema` — no locally-remapped reason
    codes or hand-rolled envelope parsing.
13. **Agent selection stays local** — choosing which local agents to set up is a
    local-machine decision driven by CLI/Desktop; Web observes and points.
14. **Account/device/lane alignment** is proven locally and fails closed before
    any setup/repair flow claims the reply path is ready — never inferred from Web.

## 3. Settings taxonomy

Collapse the overloaded concepts (Account Profile / Agent Profile / Local Agent /
Computer / OpenMeld Service / Service Profile) into stable user-facing nouns keyed to
mental verbs:

1. **Account** — "who I am to the cloud": identity, sign-in/providers, sessions,
   CLI tokens. (= today's `account.tsx`, moved under Settings, largely unchanged.)
2. **Computers** — "my machines": Computer cards live inside the owning Human
   Profile in People, and the bottom toolbar opens the signed-in member's
   current Computer detail directly. Each Computer is the entity; the **OpenMeld Service**
   (version / health / status / update / autostart) and its **local agents**
   (Codex / Claude Code / Grok Build / Cursor / OpenCode / OpenClaw, shown by product name)
   are folded IN as
   properties of that machine — not peer cards. (This is where today's
   `agents-page.tsx` Computer-tab state machine belongs.)
3. **Team** — the people directory owns Human Profiles and member invitation
   entry. Each person's Agent list leads to ordinary Agent Profile identity
   (name / model / reasoning). `Directory` remains an internal data-domain term, not a
   user-facing navigation container. The Agent readiness badge
   (`Available / …`) lives on the Agent — not on a Computer card.
4. **Service preferences** — local app behavior (service autostart,
   open-at-login, update channel). This is host-specific and capability-gated,
   not a Web top-level Settings sidebar item.

**Binding is a relationship, never a top-level noun** — surfaced inside Computer
detail and Agent detail as "Agent X runs on Computer Y". No top-level "Bindings"
or "Machines" entity.

## 4. Information architecture

Web's normal Settings utility now opens a global sidebar dialog over the current
page, as specified in `web.md`. The standalone Settings routes below remain
supported without normal navigation entry points. Both use the same registry,
grouped navigation, and section renderers; the presentation does not own another
copy of settings data or mutation logic.

The routes and destination list in this section are not the current Web target.
Use `developing/clients/web.md` for current routes and placement. The durable
guidance retained here is that entity destinations use real routes, Binding is
not a top-level product noun, and local-service controls remain capability-
gated.

Each domain is a **real route**, not a scroll anchor. Current Web uses the fixed
ten-destination product rail, separated Settings utility, and **Personal /
current Organization name** Settings groups from `developing/clients/web.md`.
App management exists once under **Plugins** in both personal and
multi-member workspaces. Routines is a Center Agent use-and-creation surface,
not a global Settings page or root product peer.

`/app/settings/service` remains a real leaf route for future hosts with
`LOCAL_SERVICE` capability. On plain Web it is gated out and redirects to Account,
so Service does not appear as a top-level sidebar item.

Reuse the existing `shell-layout.ts` `staticData` section mechanism
(`resolveAppShellSectionFromMatches`) so routes give free deep-linking,
back/forward, and per-panel auth/loaders. The inner secondary rail is a thin nav
over the active host's visible routes. **Scroll-spy is used ONLY inside a long
flat-form leaf panel** (Account, future host-specific Service preferences), built
as one tested `useScrollSpy` unit (IntersectionObserver single-active-band,
programmatic-scroll lock, `history.replaceState`, focus-to-heading on jump,
`prefers-reduced-motion` instant jump). Route picks the panel; scroll-spy picks
the sub-section. This satisfies "one Settings destination" without one 12000px
DOM scroll.

### Computers — People-owned cards and direct detail

People owns the Computer list for each Human Profile. Selecting a Computer card
opens the durable detail route `/o/{orgSlug}/computers/{deviceId}`; its back
affordance returns to the owning Human Profile. `/o/{orgSlug}/computers` is a
compatibility handoff only: it opens the signed-in member's current Computer
detail, or People when no current Computer exists. If a stale `:deviceId` no
longer resolves, the detail shows an explicit not-found state with a return to
People instead of silently choosing another machine.

## 5. Shell model — shared primitives remain active

The Web shell is a stable two-layer composition built from the shared
`packages/ui` Sidebar family and Web-owned persistence/navigation adapters:

- **App canvas** — the full-window background layer that owns the persistent
  outer app rail and the bottom global control row.
- **Inset app surface** — one bounded surface inside the remaining viewport. It
  contains the optional inner contextual sidebar, required content region, and
  optional right drawer as one visual unit.

- **Outer app rail** — always reachable on Home, Spaces, Direct
  Messages, People, Agents, Projects, Documents, Agent Activity, and
  Settings. The selected workspace switcher is its top identity surface. Home
  contains **Center Agent**, **Spaces**, and **Team**, followed by a separate
  **New Agent** action. Team opens People;
  Agents are reached through each person's profile and nested Agent routes.
  Projects, Documents, and Agent Activity routes
  render the same rail without a matching primary destination while their
  future placement remains unsettled. Settings remains a bottom
  utility that opens Account settings. The footer account dropdown offers a second
  link to that same global Settings destination. The workspace switcher contains
  only organization selection and management actions. Send
  feedback lives in the Personal Settings group rather than as a second
  outer-rail utility. The rail has no
  separate OpenMeld brand row. A nested account row
  in the footer dropdown owns browser-saved account switching, adding, and
  sign-out without becoming another navigation destination. The application
  rail stays fixed; resize and collapse belong to the middle contextual column.
  The desktop rail displays icons with compact labels, while the mobile app
  drawer displays full-width navigation rows.
- **Global controls** — a Web-owned toolbar in the bottom canvas gutter outside
  the inset surface. The current Computer sits at the far-left edge next to the
  outer rail. Center Agent and Inbox remain adjacent at the far-right edge.
  Computer opens the current device detail directly and carries its actionable
  status tone; it never opens a Computer picker.
  Inbox opens its responsive attention preview and maximizes to the canonical
  full Inbox page. Center Agent opens a compact synchronized view of the same
  canonical Chat or Task and maximizes to that exact route; it never creates a
  new session or conversation store. An unavailable control must not leave a
  placeholder or dead action.
- **Inner contextual sidebar** — optional, rendered inside the inset app
  surface, and owned only by route families that need contextual navigation.
  Spaces, Direct Messages, and Center Agent conversations share the Spaces
  list in the middle column, with Spaces and Direct messages as groups. Team
  uses the same member list across People, Agents, and Plugins, and Settings
  retains its own contextual navigation. Team tab content uses the shared page
  inline padding, including the Plugins catalog and detail pages.
  The middle column can be resized or collapsed while the application rail and
  current work remain mounted. Existing outer-sidebar persistence stores its
  geometry; the shared Fluid engine retains resize, keyboard, and edge-reveal
  behavior. The Spaces heading opens the Space directory, without a duplicate
  aggregate status dot. Direct messages is a tab after Your Spaces. Its plus
  menu offers New message and New Space. Browse spaces is visible in both views,
  and empty search results offer Find someone with the query prefilled in the
  organization picker. Team remains the member directory, without a separate
  Contacts destination. Recent is the default unless the user chose Grouped. It keeps the same Pinned rows and
  orders other conversations by message time. Both views share row presentation
  and destinations. The view is a browser preference scoped to account and
  Organization; it neither navigates nor remounts the conversation pane.
  Only that contextual region scrolls. Space groups appear between
  Pinned and Spaces; their section actions create Spaces/groups and select
  Priority, Recent activity, or Manual order independently. Unpinned sections
  use the same Priority ranking: human input, unread messages, active
  work, then idle Spaces, with recent activity breaking ties. Opening a Space must not promote it
  merely because its visit timestamp changed. The shared Pinned section keeps
  manual order across both conversation kinds. Recent uses message time and
  leaves conversations without messages last. Dragging the whole row changes manual order
  within Pinned or across groups belonging to the same conversation kind.
  Crossing the
  Pinned boundary uses the same Account Space pin mutation as the row control;
  a failed pin mutation must not save a new group placement. Custom groups can
  be renamed inline from section settings (Enter or blur saves; Escape cancels).
  Drag a custom group's title to reorder custom groups in Spaces, Direct
  Messages, People, or Agents; built-in groups keep their fixed positions.
  Row and group drags use a horizontal insertion line, including gaps and empty
  sections. Rows stay stationary during dragging; dropping inserts before the
  indicated row (or at the end), then settles using transform-only motion.
  Reduced-motion preferences disable the settling animation. Group order uses
  the existing saved group array, independently of each group's row sort.
  People and Agent row actions reveal immediately without translation or fades.
  Deleting a group returns its Spaces to
  the ordinary list without changing membership or deleting Spaces.
  Groups and ordering are personal account × Organization preferences, stored
  by Auth with revision-checked writes and refreshed on window focus. They do
  not alter another member's sidebar or authorize access to any Space.
  Preserve contextual scroll position across detail navigation. Unseen membership
  alone does not brighten a Space name; unread activity, selection, and hover do.
  Section actions appear on their own group's hover or keyboard focus, remain
  visible while their menu is open, and stay discoverable on touch devices.
  Messages reuses the same section actions, ordering, and drag primitives.
  Its optional `messages` preference namespace stores independent Pinned,
  Direct Messages, and named group orders. Pin state still belongs to the
  existing Account Space history, not sidebar preferences. Deleting a group
  returns conversations to Direct Messages without changing membership.
  The section add menu opens the shared DM open-or-reuse contract through an
  active People/Agents picker; creating a sidebar group never creates a group DM.
  Older clients omitting `messages` cannot erase it on a revision-checked save.
  Pin/unpin actions reveal on their row's hover or keyboard focus, including
  inside Pinned. Unread and work indicators remain visible without hover.
  When both are present, the active Wake indicator takes the trailing slot ahead
  of the unread dot and timestamp; unread styling and accessible text remain.
  People reuses the Web-owned section actions, drag mechanics, manual ordering
  and revision-checked preference hook. Starred and named People groups are
  personal to the account and Organization. Moving a person changes only this
  sidebar arrangement; deleting a group returns its members to Computer online or
  Computer offline. Center Agent is the first item in Online, with no separate
  group in either the sidebar or Team grid. Its card shows a Center Agent badge
  beside the name and identifies its owning Organization below, without
  increasing the standard card height.
  The signed-in member defaults to Starred; explicit unstar or
  custom placement is preserved. Connection labels describe computers, not people.
  These sections are projections, not editable membership. Their ordering
  preference is shared across both sections; named groups and Starred each
  have their own sort. Spaces use a fixed 20px member-avatar slot: one avatar,
  a diagonal pair, or the first three active members in a triangle. Row tooltips
  include the full active-member count. Member identity comes from the opt-in
  Space Index preview; Organization profile presentation supplies current human
  avatar images and Agent controller logos without per-row requests.
  Profile sidebar avatars are 20px, row action icons are
  14px inside 24px targets, and contextual group
  labels have an 8px gap before their content.
  People contextual controls render into the Team navigation row's
  action slot, preserving local ownership of search and filter state. Actions
  reveal on hover, focus, open menus, and touch. Search starts collapsed unless
  a query is already active, opens with focus, and closes by clearing the query
  and returning focus to its trigger. Search reveal animates opacity/transform
  only and respects reduced motion. Fi