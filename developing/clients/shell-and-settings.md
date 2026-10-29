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

Current Web uses a 64px application rail (52px in **Icons only**), with a separate
**New Agent** creation action and contextual lists in a collapsible middle column.
**Settings** lives in the account menu. **Projects**, **Documents**, and **Agent
Activity** retain their routes and product surfaces but are temporarily hidden
from this rail. The bottom toolbar puts
the signed-in member's current **Computer** at the far-left edge of the inset
content column and keeps **Center Agent / Inbox** together at the far-right
edge, and
the **Personal / current Organization name** Settings groups defined in
`developing/clients/web.md`. Center Agent uses the shared Spaces list; **Messages /
Tasks / Graph / Files** live in its header. **Channels** and **Memory** reuse their existing cards inside App Settings → Center Agent, below the general settings. Legacy management URLs redirect there and preserve channel OAuth results. Chat
settings remain in the compact menu on conversation surfaces only. Center Agent settings live in
the global App Settings destination, grouped under the current Organization
(or Personal in a Personal Workspace).

The Web application rail places the Organization selector above compact history,
search, and Inbox controls. The work-area header toggles the middle column. Its
footer uses the Fluid user dropdown with account switching, Search, Settings,
theme selection, and Log out. Search has a separate divided section; theme
selection follows Download Desktop App. Appearance uses full-size theme cards
with the same choices and theme provider. Authentication, history, and theme
ownership remain in the existing Web hooks and router.

One shell and one Settings framework let Web and the Electron GUI reuse shared
pieces without forcing two clients to keep an obsolete route map. Current Web:

- keeps **Inbox / Spaces / Team / Routines** as the fixed
  visible product destinations, temporarily omits **Projects / Documents /
  Agent Activity** without relocating them, separates Settings as a utility,
  and opens the current Computer, Center Agent, and Inbox from the app canvas's
  global toolbar;
- uses one Settings destination with stable **Personal** and dynamically named
  current Organization groups;
- orders Team tabs as **People / Agents / Files / Skills / Plugins**. Plugins retain
  personal and named Organization configuration; Skills use one Organization
  catalog, including in personal workspaces, without a second scope selector;
- opens Team on its people directory, with each person's Computers and Agent list
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

Account deletion lives below Sessions in Web Settings > Account. Its shared
Dialog identifies the signed-in email and lists deleted assets, retained team
work, and required ownership handoffs. Confirm the current password (or a recent
passwordless sign-in), then type DELETE. Recheck the inventory on submission.
Cancel clears both inputs. Desktop opens the same Web owner through its existing
account-settings handoff. The signed-out result states that cleanup continues.

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
supported for direct links and the dialog's expand control. Both use the same
registry, grouped navigation, and section renderers; the presentation does not own another
copy of settings data or mutation logic.

Contextual navigation accepts an explicit accessible label when an accessory
adds meaning beyond the visible title. Keep the visible title stable; expose
pending attention in the accessible label and keep the decorative indicator
hidden from assistive technology. Route links and dialog buttons use the same
contract. Desktop's Settings-to-Updates attention policy remains owned by
`desktop.md`, not by the shared navigation primitives or Inbox counts.

The routes and destination list in this section are not the current Web target.
Use `developing/clients/web.md` for current routes and placement. The durable
guidance retained here is that entity destinations use real routes, Binding is
not a top-level product noun, and local-service controls remain capability-
gated.

Each domain is a **real route**, not a scroll anchor. Current Web uses the fixed
four-destination product rail, separated Settings utility, and **Personal /
current Organization name** Settings groups from `developing/clients/web.md`.
App management exists once under **Plugins** in both personal and
multi-member workspaces. Routines is a primary use-and-creation destination for
personal and shared work, with its existing Organization-scoped route and permissions.

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
  contains **Inbox**, **Spaces**, **Team**, and **Routines**. Team opens People;
  Agents are reached through each person's profile and nested Agent routes.
  Projects, Documents, and Agent Activity routes
  render the same rail without a matching primary destination while their
future placement remains unsettled. The footer account dropdown opens global
Settings and contains Search and theme selection. The workspace switcher contains
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
  Inbox opens its responsive grouped preview with a fixed **Open full Inbox**
  link to the canonical page. Center Agent opens a compact synchronized view of the same
  canonical Chat or Task and maximizes to that exact route; it never creates a
  new session or conversation store. An unavailable control must not leave a
  placeholder or dead action.
- **Inner contextual sidebar** — optional, rendered inside the inset app
  surface, and owned only by route families that need contextual navigation.
  Spaces, Direct Messages, and Center Agent conversations share the Spaces
  list in the middle column, with Spaces and Direct messages as groups. People
  owns the member sidebar, Agent detail owns its Agent list, and Files owns file
  locations. Agent directories, Skills, Plugins, and Routines use their existing
  in-page search and filters without a member sidebar. Settings
  retains its own contextual navigation. Team tab content uses the shared page
  inline padding, including the Plugins and Skills catalog and detail pages.
  Skills loading/error states retain Team's header and rail highlight rather
  than mounting Center Agent context. Canonical routes and compatibility
  redirects are owned by [web.md](web.md#organization-skills).
  Inside that unchanged shell, Skills uses a compact catalog and a document-first
  detail with a sticky Save/action row. Optional Files tabs and contextual
  Properties/history/management dialogs do not add another navigation sidebar
  or alter Team scope. Creation/import and inner dialogs reuse shared Fluid
  focus, dismissal and scroll mechanics; the Skill draft remains Web-owned.
  The middle column can be resized or collapsed while the application rail and
  current work remain mounted. Existing outer-sidebar persistence stores its
  geometry; the shared Fluid engine retains resize, keyboard, and edge-reveal
  behavior. Without an explicit visibility choice, overview pages start collapsed
  and conversation, person, and Agent detail pages start expanded. These route
  defaults are not saved as user choices, including when group collapse is saved.
  Explicit expanded/hidden choices remain shared across the Spaces directory,
  conversation details, and Team tabs, including People and Agents, and survive
  reloads. Navigation never resets that choice; existing cookies remain valid.
  The Spaces heading opens the combined conversation home, without a duplicate
  aggregate status dot. On home the list is primary content, always visible at
  full width on narrow screens and beside a selection prompt on wide screens.
  This does not overwrite the contextual sidebar's explicit visibility choice.
  Direct messages remains a secondary directory tab after Your Spaces. The plus
  menu offers New message, New Space, and Browse Spaces. Browse Spaces opens
  `?view=spaces`; the directory's Chats tab returns home. Home search is always visible,
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
  inside Pinned through its action menu. Pinned conversations use the shared
  Fluid navigation hover in a responsive grid with up to two-to-four columns,
  depending on sidebar width, and 48px avatars with two-line labels. Fewer pins
  use only the columns they need: one pin fills the row with centered content.
  Grid hover uses both pointer coordinates. The grid shows two rows until expanded; hidden
  unread, attention, and active-work states mark the disclosure control. Dragging
  expands all targets and uses row-major insertion boundaries. Recent and named
  groups retain list rows and optional message previews.
  Unread and work indicators remain visible without hover.
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
  only and respects reduced motion. Filter menus remain left-aligned.
  The optional `people` preference namespace needs no DB migration. Auth preserves
  it when an older Space-only client saves. Deploy the supporting Auth receiver
  before Web; no CLI, Service, Core Wake or Gateway execution contract changes.
  Agents shares these controls and stores its arrangement in the optional
  `agents` namespace. Named groups can contain Agents from different owners;
  moving back to an owner section requires the Agent's actual owner to match.
  Owner filtering combines with search and availability filtering, including
  counts. An Agent outside the selected owner is not retained in the list.
  Availability uses the canonical Core projection: a dot next to the name,
  with detail in its tooltip, or the shared Thinking icon for Checking.
  This display does not grant Wake permission. Row Chat actions open the existing
  Direct Message flow. Older clients preserve both omitted collection namespaces.
  Shell geometry selectors must target the immediate sidebar owner; an
  unbounded descendant `:has()` invalidates the full surface on row hover.
  Agent Activity keeps Overview / Sessions / Changes in its inner sidebar.
  Settings owns its Personal /
  current Organization section navigation. Every inner sidebar header shows one
  compact title only; it does not repeat the section purpose as a description.
- **Content** — the required scrollable main region inside the inset app
  surface (Space conversation,
  `/app/new-space`, or a routed Settings panel). Full-width routes that do not
  own an inner contextual sidebar do not render an empty header strip. Their
  content region owns a modest top inset so page titles keep comfortable
  breathing room without implying a separate header row. An explicit flow such
  as `/o/:orgSlug/new-space` may keep the header only when it contains real
  navigation such as **Back to Spaces**; without an inner sidebar, that
  navigation header has no bottom divider. The Organization Connect route uses
  the same full-width inset surface and places its Back control directly at the
  content region's upper-left edge instead of restoring a cross-page header.
- **`aside`** — optional right drawer inside the inset app surface (Space
  members panel).

### Conversation layout preference

Full width uses one shared 8px inline-padding token for the main conversation
and Thread messages and composers. Thread rows add no second inline inset in
this mode. Centered keeps its existing main-column maximum, 16px content
padding, and independent Thread panel width and row padding. The history slider
owns only the additional lane beside the main conversation; a Thread never
inherits that lane. Desk windows keep their independent content frame and
existing Thread spacing, regardless of this page preference.

### History slider preference

Personal Spaces settings' **History slider** uses the existing Fluid radio cards with **Show**
and **Hide** previews. Both choices keep the browser-local
`openmeld.space.history-slider` preference. A Space reserves the slider lane only
when the slider is visible: Messages is selected, the viewport supports it, and
its authorized history directory has older messages. Short conversations and
unavailable directories reserve no lane. The slider retains its 8px leading inset
and compacts the space on its message side. The desktop pointer lane is 36px;
fine pointer content uses 4px of leading padding beside the slider, while its
trailing padding uses the conversation layout's shared token: 8px in Full width
and 16px in Centered. Coarse pointer devices retain a 44px touch target
in a 52px lane and keep the standard content padding.

### Bot appearance preferences

Appearance owns browser-local Bot avatar preferences. Fabric is the default
material; Fabric and Plastic radio choices include matching live previews and
apply through the shared Agent avatar presentation across the app. The existing
animation switch keeps its storage key and disables working and interaction
motion, including the material previews. Reduced motion takes precedence.
These preferences do not change the Organization's saved Agent identity or shape.

### Responsive shell presentation

Responsive presentation does not create a second navigation model or change
the route topology:

- At `lg` and wider, the outer app rail stays inline on the app canvas. Its
  width follows the browser-local display preference.
- Below `lg`, the outer rail opens as a modal left drawer from the shared app
  header. The drawer always shows full destination labels and must not write a
  transient width or tier back to the desktop rail preference.
- The inline outer rail offers **Icons and text** (default) and **Icons only**
  through its context menu and Appearance's **Sidebar** group. Both controls
  share one browser-local preference. The same Fluid navigation rows, icon
  targets, indicators, and accessible labels remain mounted in both modes;
  Icons only uses the shared Fluid `SIDEBAR_ICON_WIDTH` (52px), hides text, and
  uses shorter rows while retaining 36px icon targets. The drawer keeps full labels.
- At `md` and wider, a route family's inner contextual sidebar stays inline
  inside the app surface with its existing persisted family width. Below `md`,
  the same contextual navigation opens from the shared header as a modal left
  drawer and the main work region receives the full viewport width.
- Drawer presentation reuses the same rail and contextual-navigation
  components. It does not duplicate routes, data ownership, or mutation
  surfaces. Opening, Escape, overlay dismissal, focus trapping, and focus
  restoration follow dialog semantics.
- Narrow-screen controls use touch-sized shell targets, account for viewport
  safe areas, and keep the global toolbar outside the work region. Motion must
  reduce to no transition when the browser requests reduced motion.

The responsive breakpoints are presentation boundaries only. Desktop geometry
and its SSR-readable preferences remain unchanged.

This collapses the old hard-branch layouts in `app-shell.tsx` for Space,
Settings, and Connect. The legacy Start surface may still use the older
cross-page header until it is explicitly moved into this shell.

### Center Agent owns an independent route layout

The pathless Center Agent layout branch owns both canonical Home at
`/o/{orgSlug}` and the explicit `/o/{orgSlug}/center-agent/*` capability routes.
Home renders the canonical Center Agent conversation directly. The outer rail
therefore exposes one **Home** destination rather than separate Home and Center
Agent entries; Center Agent capability routes also keep Home selected. The
branch owns its header navigation and pending UI without a secondary sidebar.
Outer-rail selection comes from the deepest route match, so direct entry,
Organization switches, and browser history cannot paint a different
destination first.

### Space adopts the same shell

The persistent outer rail and inset app surface wrap every Space view.
**Space =** app canvas with outer rail + inset app surface containing the inner
Spaces sidebar + conversation content + optional members drawer.
`/app/new-space` is also rendered in the Spaces shell content region, with Spaces
active in the outer rail and the Spaces sidebar available only after a human
profile is resolved and the current organization has at least one Space.
`/app/spaces` redirects to `/app/new-space` while the current organization has
no Spaces, so the first-run Space UI has one route owner.

The old Space-header horizontal app nav was removed. The Space header now keeps
only space-**context**: title + live dot, the `N members · Public · agents live ·
Joined as …` subtitle, the `space-profile-switcher`, and share / members / info
actions. Inner conversation, members drawer behavior, Spaces list, pinning, and
shared-layout active/hover backgrounds remain the same. Net win: the app-level
navigation lives in one place — the outer rail — instead of being duplicated in
the Space header.

### Window chrome lives OUTSIDE the shared shell

The shared shell renders app canvas + outer rail + global controls + inset app
surface only — it starts BELOW any window chrome. Desktop wraps it in a `WindowFrame` owning
traffic-light insets, `-webkit-app-region` drag, and tray; Web wraps it with no
chrome. Same shared content shell, different outer wrappers — the route to
"identical look" without leaking Electron concerns into shared code.

### Surface tokens

The app canvas and inset surface must read as distinct layers in the
low-contrast system. Web owns `--app-canvas` as the background behind the outer
rail. The inset surface and its inner contextual sidebar use `--background` as
one continuous plane; `--border` owns both the surface perimeter and internal
dividers. The outer rail is borderless against the app canvas; full-height
column borders must not recreate the old flat three-column frame. The inset
surface keeps its canvas gutter on the top, right, and bottom. The bottom
gutter owns the global control toolbar; controls stay outside the inset surface
and must not cover its content. A subtle perimeter outlines the inset; the Main Sidebar boundary only
highlights during hover, focus or resize. Hidden mode restores the left canvas
gutter, and its restore button sits in the bottom toolbar gutter. Peek ends
above that toolbar instead of covering the controls. The
inset surface uses the shared semantic radius tokens, so it follows the same
radius scale as controls, selected backgrounds, and other surfaces in the
default Rounded appearance, and becomes square only when the user selects
Square.

## 6. Shared Sidebar family and resize behavior

The outer rail's Spaces and Team resource popovers open on hover or Arrow Down/Space.
Clicking Spaces opens the combined conversation home; clicking Team opens People.
Each popover starts with that primary destination: Chats or People, without
a pin toggle. Spaces then offers Direct messages and Discover using the existing
`view` search parameter.
The pinned Direct messages label is DMs. Discover is hidden in personal workspaces,
including saved pins, without deleting the browser preference.
Agents, Files, Skills, and Plugins link to the existing
Team destinations and each has a separate Pin to sidebar toggle. Routines stays
in the primary rail; old saved Routine pins do not create a duplicate. Pins start
empty, persist in this browser in selection order, and resolve against the
current Organization. A short divider separates pinned entries from the main
navigation. A pinned current destination owns the selected state instead of
also selecting Team. Compact rail tooltips open without a delay. Primary and
pinned destinations share one Fluid hover scope across the visual divider.
Tooltip visibility does not suspend hover; an open context menu does.


Main Sidebar uses the Fluid Functionalism Base UI registry components in
`packages/ui/src/fluid/sidebar*.tsx`. Its provider owns transient pointer,
keyboard and peek interaction; Web injects the persisted geometry. Business
navigation and workspace/account menus live in `app-rail-navigation.tsx` and
`app-workspace-switcher.tsx`; `AppOuterRail` composes them with Fluid's
header/content/footer and collapsible group slots. Row density, typography,
semantic radii, icons and status indicators retain OpenMeld's design tokens.

There are three desktop modes: hidden (0 px), icon-only (52 px), and expanded
(160–384 px, initially 220 px). Dragging crosses snap regions with hysteresis
and can reverse across all three in the same gesture. Expanded width remains
remembered through icon and hidden modes; only releasing a drag writes the
preference. Clicking the edge or pressing `[` / Cmd/Ctrl+B toggles expanded and
hidden; clicking from icon-only restores expanded. Editable fields and mobile
drawers do not handle these shortcuts.

Hidden mode exposes a hover-intent peek strip and a persistent restore button.
Peek overlays the inset without changing its layout or saving a new mode.
Owned popup menus remain usable outside the peek card. Leaving the card,
pressing Escape, choosing a navigation link, or clicking outside dismisses it;
keyboard focus inside the card or an owned popup keeps it open. Escape closes
a nested popup before the peek. The resize tooltip follows the pointer and
explains both dragging and clicking; its divider highlight fades at the ends.
Reduced motion disables movement. The existing Web responsive drawer remains
the sole mobile navigation presentation and does not overwrite desktop geometry.

Inner contextual sidebars retain `packages/ui/src/components/sidebar.tsx` and
its `use-sidebar-resize.ts` engine for resize-only behavior. Main Sidebar does
not stack that engine under the Fluid provider. Do not reintroduce the removed
`components/resizable-sidebar.tsx` facade or a second Main Sidebar state owner.

Web contextual navigation composes that family through
`AppContextualSidebarNav` in
`clients/web/src/components/app/app-contextual-layout.tsx`. This component is
the single owner of the compact header, content gutter, group-label spacing,
accessible Base UI Collapsible disclosure, active/focus treatment, and standard
item density used by Center Agent, Agent Activity, Spaces, and Settings. Route
families provide typed group configuration instead of rebuilding those
primitives. A group may provide standard navigation items or custom dynamic
content; `leadingContent` is reserved for a primary contextual action such as
New Space. Dynamic content may own its business interaction, but it must reuse
the shared typography and tone tokens rather than introducing another sidebar
style system.

Resize affordance lives on the rail/divider itself. The shared engine supports
pointer drag and keyboard resize (`role="separator"`, arrow/Home/End semantics,
ARIA min/max/current values). Main Sidebar adds resize, collapse and peek through Fluid. The inner
contextual sidebar is resize-only: its rail does not toggle collapse.

Persistence is injected by each client. Web stores non-sensitive layout
preferences in first-party cookies so SSR can read them with no width flash.
The same SSR-readable state stores width, tier, and stable ids for explicitly
collapsed labeled groups, so disclosure state does not flash open during
hydration. The outer rail stores browser-wide mode and collapsed groups, plus
independent expanded widths keyed by stable app shell section:

- outer rail: `openmeld_sidebar_outer`

Each section shares its width across detail routes and Organizations. A section
without a customized width uses the default. Navigation supplies the restored
width to the existing Fluid geometry animation; reduced motion remains honored.

Without that cookie, Web defaults the outer rail to the expanded mode so a new
user sees every destination label. Once the user changes tiers, Web restores
that browser-wide choice without resetting it for a different account. The
existing expanded (0) and icon-only (1) cookie tokens keep their meaning; the
retired compact icon-and-label token (2) restores expanded, and hidden uses 3.
Width and collapsed-group preferences survive this migration.

Inner contextual sidebars persist independently by stable route family. A
family shares one width and one collapsed-group set across its child routes,
selected records, and Organizations; persistence must not derive keys from a
full pathname, Organization slug, Space id, Direct Message id, or Task id. New
dynamic groups, including future member-defined Space groups, must use their
stable group identity rather than their editable display label:

- Center Agent: `openmeld_sidebar_inner_center_agent`
- Spaces: `openmeld_sidebar_inner_spaces`
- Direct Messages: `openmeld_sidebar_inner_direct_messages`
- Agent Activity: `openmeld_sidebar_inner_agent_activity`
- Settings: `openmeld_sidebar_inner_settings`

`openmeld_sidebar_inner` is the read-only migration fallback for a route family
that has not yet written its independent preference. New inner-sidebar writes
must never update that legacy global value.

`packages/ui` must stay pure: no router, Electron, `document.cookie`,
`localStorage`, or `sessionStorage` access. The application storage owner uses
SSR-readable cookies on Web and the existing local browser-preference storage
on Desktop, against the same controlled geometry callbacks and serialized state.
Desktop uses its persistent application partition; visibility stays automatic
until an explicit show/hide choice.

Fallbacks only (not adopted): `react-resizable-panels` (shadcn's official
Resizable engine, %-based; for a plain non-Sidebar split) and `allotment`
(px-native, VS Code lineage; SSR needs care).

## 7. Settings framework — shared primitives, per-client fillings

Three layers, to avoid a two-headed data layer (Web cards are React Query
mutations against the gateway; Desktop rows are Electron IPC / electron-store):

1. **Sidebar family + Settings primitives** → `packages/ui`, ZERO data. Web uses
   a Web-owned Settings sidebar today so it can live inside the unified app shell;
   `SettingsShell` / `SettingsNav` remain pure shared primitives for future hosts
   that need a standalone settings frame.
2. **`SettingsSection` / `SettingsRow` / `SettingsField`** → `packages/ui`,
   controlled presentational primitives with dirty / saving / error states.
3. **Concrete config rows** (e.g. a password row via React Query on Web; an
   open-at-login row via IPC on Desktop) → stay PER-CLIENT, each owning its data
   binding.

Driven by a declarative registry:

```
SettingsSection = { id, title, anchor, requires: Capability[], render(ctx) }
Capability = CLOUD_ACCOUNT | LOCAL_SERVICE | ELECTRON_HOST   // a 3-tier enum, NOT a boolean isDesktop
```

The runner filters sections by host capability and renders the survivors — an
absent capability means no anchor, no fork. This is the VS Code model (share the
workbench, never the services). **Preserve per-card autonomous save** (each section
owns its mutation + dirty state + toast, as `account.tsx` already does) — never a
page-level Save on a long scroll. Lazy-mount heavy below-fold sections.

## 8. Service · Preferences — two autostart settings, two owners

Render as **two distinct rows with different owners** — never merged into one
"Autostart" control:

- **Open OpenMeld Desktop at login** — Electron-only (`app.setLoginItemSettings`; XDG
  `.desktop` on Linux). Never touches the CLI/service.
- **Run the OpenMeld Service in the background** — a **read-mostly reflection** of the
  launchd/systemd state the CLI/service already owns. The UI READS the state; any
  toggle routes through a CLI command (e.g. `openmeld service autostart enable/disable`)
  — never an independent Electron pref or a direct system/plist write.

New IPC channels are NAMED allowlist entries with per-arg validators (mirror
`validateAgentToggleInput`); never a generic `runCliCommand(string)` channel. When
this lands, update [desktop.md](desktop.md) with the owner of each setting in the
same PR.

## 9. Load-bearing constraints (summary)

- **Shared shell is purely presentational** — router/query/IPC/storage/window-chrome
  are ALL injected via props (`activeSectionId / onNavigate / renderLink / width /
onWidthChange / sections`), never imported. `app-shell.tsx`'s TanStack-Router
  coupling (`useMatches` + `shell-layout.ts` module augmentation) and Web cookie
  persistence STAY in `clients/web` and never move to `packages/ui`. Enforce with
  a boundary test (mirror the mention-boundary scan): `packages/ui` fails CI if it
  imports router/electron/window.openmeld/cookie/storage APIs.
- **Do not duplicate shell authority** — app-level navigation belongs in the outer
  rail. Space headers carry only Space context and Space actions.
- **Settings search (Cmd-K)** is the real growth lever — deferred, but leave room
  in the registry.
- Plus all owner-doc constraints in [§2](#owner-doc-compliance).

## 10. Sequencing

- **Web implemented:** shared Sidebar family in `packages/ui`; obsolete
  `ResizableSidebar` facade removed; Web outer rail added; Spaces sidebar rehomed;
  Settings moved into the unified shell; old Space header horizontal nav removed;
  `/app/new-space` moved into the Spaces shell content region.
- **Desktop next:** build the Electron shell skeleton against the shared Sidebar
  family and Settings primitives. Window chrome stays in a `WindowFrame` outside
  the shared shell; persistence is injected through the Desktop adapter; no router
  imports in shared UI.
- **Converge:** Desktop drops shared Settings into its content slot plus the
  two Desktop-only Service preference rows and entry points. Wiring, not a
  rewrite.

Critical path now: keep the shared Sidebar boundary pure, keep Settings top-level
terminology stable, and route host-specific Service controls through capability
gating.

## 11. Open decisions

- **Runtime term:** keep **local agent** (recommended, adopted here) vs rename to
  "agent runtime" (would require amending the shipped `Connect local agent`
  manifest label across owner docs + CLI in the same PR). If B is ever chosen, it
  is a global find/replace + one manifest PR; it changes no other decision here.

## Personal Computer entry

The account dropdown always includes Computer immediately before Settings. It
uses the same current-account Computer destination and attention projection as
the optional bottom toolbar shortcut. A shared Web provider owns the query and
validated reload hint even when the toolbar is hidden. Warning/danger attention
appears on the account avatar and the Computer menu item; opening the menu does
not acknowledge or clear it. Ordinary disconnection does not mark the avatar red.
