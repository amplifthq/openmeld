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
**Home / Center Agent / Spaces / Direct Messages / People / Agents / Computers / Projects / Documents / Agent Activity**
product rail, with **Settings** as a separated utility and **Inbox** in the
bottom-right global control area, and
the **Personal / current Organization name** Settings groups defined in
`developing/clients/web.md`. Center Agent has no secondary sidebar: **Messages /
Graph / Files / Tasks / Routines / Skills / Apps** live in its header, while
**Channels / Memory / Center Agent settings** live in its compact header menu.

One shell and one Settings framework let Web and the Electron GUI reuse shared
pieces without forcing two clients to keep an obsolete route map. Current Web:

- keeps **Home / Center Agent / Spaces / Direct Messages / People / Agents /
  Computers / Projects / Documents / Agent Activity** as the fixed product
  destinations, separates Settings as a utility, and opens Inbox from the app
  canvas's global control area;
- uses one Settings destination with stable **Personal** and dynamically named
  current Organization groups;
- gives Human teammates, ordinary Agent Profiles, and personal computers the
  parallel first-level **People / Agents / Computers** homes;
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

| Concept | UI copy | Reserved for diagnostics/schemas |
| --- | --- | --- |
| The local service daemon | **OpenMeld Service** | `ServiceRuntime` (internal durable record) |
| The agent program on a machine (Codex / Claude Code / Grok Build / Cursor / OpenCode / OpenClaw) | **local agent** (+ its product name) | `Agent Controller` (execution of one Agent Profile) |
| An account-level agent identity (name/model/reasoning) | **Agent** | `Agent Profile` |
| "Which machine runs which agent" | "**Agent X runs on Computer Y**" / "Use this agent on this machine" | `Binding` (`Agent Profile → openMeldServiceRuntimeId + agentControllerRef`) |
| Service liveness | **Connected** / **OpenMeld Service is running** | heartbeat-fresh `ServiceRuntime` |
| Agent reachability | **Available for Wake / Checking / Offline / Unavailable** | projection states (registered/pending/skipped/rejected/expired/unavailable) |

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
   heartbeat fresh; (b) Agent Available for Wake = Core readiness projection; (c)
   Agent bound to this Computer = a Binding exists. Service health is NOT product
   readiness — never derive a green "agent can reply" from service status alone.
4. **Availability states are Core-owned** — render `Available for Wake / Checking
   / Offline / Unavailable`, sourced from the projection; never synthesized from
   service health or binding presence.
5. **Diagnostic data must not pollute availability.** EvidenceSyncHealth, stale
   controller reports, aged/progress evidence, evidence freshness are
   diagnostic-only — never availability/readiness blockers, never in public badges.
6. **Status surfaces are read-only.** Status displays never silently
   start/stop/repair/reinstall/toggle. Explicit user-visible actions only.
7. **Setup action labels come from the Local Components Manifest** (`Connect OpenMeld
   Service`, `Reconnect OpenMeld Service`, `Update OpenMeld Service`, `Connect local agent`,
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
2. **Computers** — "my machines": a first-level product home in Web. Each Computer is the entity; the **OpenMeld Service**
   (version / health / status / update / autostart) and its **local agents**
   (Codex / Claude Code / Grok Build / Cursor / OpenCode / OpenClaw, shown by product name)
   are folded IN as
   properties of that machine — not peer cards. (This is where today's
   `agents-page.tsx` Computer-tab state machine belongs.)
3. **People / Agents** — **People** owns Human Profiles and member invitation
   entry, while **Agents** owns ordinary Agent Profile identity (name / model /
   reasoning). `Directory` remains an internal data-domain term, not a
   user-facing navigation container. The Agent readiness badge
   (`Available for Wake / …`) lives on the Agent — not on a Computer card.
4. **Service preferences** — local app behavior (service autostart,
   open-at-login, update channel). This is host-specific and capability-gated,
   not a Web top-level Settings sidebar item.

**Binding is a relationship, never a top-level noun** — surfaced inside Computer
detail and Agent detail as "Agent X runs on Computer Y". No top-level "Bindings"
or "Machines" entity.

## 4. Information architecture

The routes and destination list in this section are not the current Web target.
Use `developing/clients/web.md` for current routes and placement. The durable
guidance retained here is that entity destinations use real routes, Binding is
not a top-level product noun, and local-service controls remain capability-
gated.

Each domain is a **real route**, not a scroll anchor. Current Web uses the fixed
ten-destination product rail, separated Settings utility, and **Personal /
current Organization name** Settings groups from `developing/clients/web.md`.
App management exists once under **Center Agent → Apps** in both personal and
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

### Computers — first-level picker pre-state

`/o/{orgSlug}/computers` opens on a **picker**, not directly on a machine's
detail: a list of selectable computer cards (e.g. "This Mac", plus any other
machines). Selecting a computer drills into its detail (Service + local agents) —
the selected Computer is a real URL block at
`/o/{orgSlug}/computers/{deviceId}`; a back affordance returns to the picker
route. The picker route doubles as the overview/empty state. If a stale
`:deviceId` no longer resolves to a Computer, show an explicit not-found state
instead of silently falling back to another machine or the picker. (Ratified via
widget preview, then updated for durable refresh/deep-link behavior.)

## 5. Shell model — shared primitives remain active

The Web shell is a stable two-layer composition built from the shared
`packages/ui` Sidebar family and Web-owned persistence/navigation adapters:

- **App canvas** — the full-window background layer that owns the persistent
  outer app rail and the bottom-right global control area.
- **Inset app surface** — one bounded surface inside the remaining viewport. It
  contains the optional inner contextual sidebar, required content region, and
  optional right drawer as one visual unit.

- **Outer app rail** — always reachable on Home, Center Agent, Spaces, Direct
  Messages, People, Agents, Computers, Projects, Documents, Agent Activity, and
  Settings. The selected workspace switcher is its top identity surface. Home
  is the first destination; the remaining fixed destinations are grouped under
  **Work**, **Team**, and **Resources**, while Settings remains a bottom
  utility that opens Account settings. The workspace switcher offers a second
  link to that same global Settings destination below its separated
  Organization actions; it does not create a second Settings surface. Send
  feedback lives in the Personal Settings group rather than as a second
  outer-rail utility. The rail has no
  separate OpenMeld brand row or account entry, and it continues to support
  resize + collapse.
  Collapsed state preserves recognizable icons for every fixed destination;
  expanded state shows the workspace identity, group labels, and destination
  labels.
- **Global controls** — a Web-owned toolbar in the bottom canvas gutter outside
  the inset surface. It contains separate Inbox and Center Agent launchers.
  Inbox opens its responsive attention preview and maximizes to the canonical
  full Inbox page. Center Agent opens a compact synchronized view of the same
  canonical Chat or Task and maximizes to that exact route; it never creates a
  new session or conversation store. An unavailable control must not leave a
  placeholder or dead action.
- **Inner contextual sidebar** — optional, rendered inside the inset app
  surface, and owned only by route families that need contextual navigation.
  Center Agent does not own one. Spaces fills it with New Space, Explore,
  Pinned, and the existing Spaces list.
  Direct Messages fills it with the current workspace's DM list, using the
  other participant's profile identity and opening the shared Space conversation
  surface in the content region. Agent Activity fills it with Overview / Sessions / Changes.
  People, Agents, and Computers are full-width homes without an inner sidebar.
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

### Responsive shell presentation

Responsive presentation does not create a second navigation model or change
the route topology:

- At `lg` and wider, the outer app rail stays inline on the app canvas with its
  existing persisted width, tier, collapsed groups, inset surface gutters, and
  resize behavior.
- Below `lg`, the outer rail opens as a modal left drawer from the shared app
  header. The drawer always shows full destination labels and must not write a
  transient width or tier back to the desktop rail preference.
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

`/o/{orgSlug}/center-agent` is nested under a pathless Center Agent layout
branch, not the Spaces layout family. Its resolved layout is outer app rail +
the Chat / Skills inner sidebar + routed Center Agent content. The Organization
index renders Home at `/o/{orgSlug}` after access is resolved; explicit Center
Agent routes remain in this independent branch, which owns its zero-delay
interactive pending UI. Outer-rail selection comes from the deepest route
match, so direct entry, Organization switches, and browser history cannot paint
a different destination first.

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
and must not cover its content. The surface's left border meets the outer rail
directly. The outer rail resize rule shares that
single boundary instead of drawing a second line across a canvas gutter. The
inset surface uses the shared semantic radius tokens, so it follows the same
radius scale as controls, selected backgrounds, and other surfaces in the
default Rounded appearance, and becomes square only when the user selects
Square.

## 6. Shared Sidebar family and resize behavior

The shared primitive is `packages/ui/src/components/sidebar.tsx`, a
shadcn-style Sidebar family adapted to OpenMeld:

- `SidebarProvider`
- `Sidebar`
- `SidebarRail`
- `SidebarInset`
- `SidebarHeader`
- `SidebarContent`
- `SidebarFooter`
- `SidebarGroup`
- `SidebarGroupContent`
- `SidebarGroupLabel`
- `SidebarMenu`
- `SidebarMenuItem`
- `SidebarMenuButton`
- `SidebarMenuBadge`
- `SidebarTrigger`
- `useSidebar`

The old bespoke `packages/ui/src/components/resizable-sidebar.tsx` facade has
been removed. Do not reintroduce it and do not re-vendor an upstream
`components/ui/sidebar.tsx` wholesale. The shared Sidebar family is the stable
composition surface; `packages/ui/src/hooks/use-sidebar-resize.ts` remains the
hardened resize engine under `SidebarProvider` / `SidebarRail`.

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
ARIA min/max/current values). The outer app rail opts into resize + collapse. The
inner contextual sidebar is resize-only: it uses the same engine, but the rail
does not toggle collapse.

Persistence is injected by each client. Web stores non-sensitive layout
preferences in first-party cookies so SSR can read them with no width flash.
The same SSR-readable state stores width, tier, and stable ids for explicitly
collapsed labeled groups, so disclosure state does not flash open during
hydration. The outer rail remains one browser-wide preference:

- outer rail: `openmeld_sidebar_outer`

Without that cookie, Web defaults the outer rail to the full tier so a new
user sees every destination label. Once the user changes tiers, Web restores
that browser-wide choice without resetting it for a different account.

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
`localStorage`, or `sessionStorage` access. Desktop should inject its own storage
adapter later (for example electron-store) against the same controlled
`width`/`open` callbacks.

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
