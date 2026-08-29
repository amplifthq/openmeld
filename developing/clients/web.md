# Web Client

## Agent Context

- Purpose: Define the OpenMeld Web client's product responsibilities in
  navigation, Projects presentation, Space collaboration, hosted reply
  streaming, Center Agent memory controls, Wake authoring, thread presentation,
  Center Agent Tasks and compact window, setup handoff, Wake availability
  display, Wake diagnostics, and browser-side diagnostic pointers.
- Read this when: You are changing OpenMeld Web navigation, Settings placement,
  Project routes or current-computer presentation, Space flows, Wake authoring,
  thread UI, reply context, hosted reply streaming, the public agent manual,
  Center Agent memory settings, Wake details, Diagnostic Reports, setup handoff
  entry, Wake availability presentation, Agent Profile surfaces, or Web
  user-facing recovery copy.
- Update this when: Web-owned navigation or product entry points, browser
  diagnostic surfaces, browser persistence, stream reconciliation, memory
  controls, thread presentation behavior, setup handoff behavior, or Wake
  availability presentation boundaries change.
- Do not use this for: Space truth, RuntimeCoordinator execution truth, OpenMeld
  Service lifecycle, Binding truth, Core readiness truth, shared schema
  ownership, CLI behavior, React style guidance, or endpoint catalogs.
- Source of truth: This file owns the durable product boundary for the OpenMeld Web
  client as a browser client.

## Boundary

OpenMeld Web is the primary browser surface for the user-visible collaboration loop:

```text
Human uses Space -> wakes Agent Profile -> local agent runs -> Space shows reply, stopped outcome, or explicit failure
```

Web owns presentation and entry points. It helps the user author messages,
understand Space conversation placement, start setup handoff, inspect Wake
details, and submit a Diagnostic Report when the visible outcome is wrong.

Web does not own the facts behind those surfaces.

It must not become the source of truth for:

- Space membership, messages, threads, or reply placement
- Agent Profile identity
- Agent Profile Binding truth
- local OpenMeld Service process, account, device, lane, or capability truth
- final Agent execution readiness
- RuntimeCoordinator execution lifecycle
- Dispatch Ledger or Wake trace truth
- Diagnostic Report derived Wake pointers

When Web needs those facts, it reads Core, Space, shared contracts,
local-service evidence, or observability read models. It must not recompute them
from browser state.

### Client version recovery

Web document responses require browser revalidation so an old HTML document
does not keep stale content-hashed asset references after a deployment.

If a page that was already open can no longer load one of those assets, Web
handles the Vite preload failure before router error rendering and performs at
most one automatic reload within a bounded retry window. If the current version
still cannot load, Web stops retrying and presents one explicit refresh action.
It must never enter a reload loop or expose internal asset URLs as user-facing
error copy.

## Navigation Topology

This section owns the current approved Web navigation topology. W-NAV1 through
W-NAV5 established the shared shell. The 2026-07-27 Center Agent consolidation
reduces the root product surface while preserving the settled navigation laws.

### Design laws

1. **Single home.** Every feature has exactly one product home. Links may lead
   there from several useful contexts, but the page and its mutation surface
   exist once. Do not build one inline panel in the personal workspace and a
   second handoff panel in an Organization view.
2. **Structural constancy.** The navigation slots are identical in a personal
   workspace and a multi-member Organization, and for members, admins, and
   owners. Context and role may change page content and available actions; they
   must never add, remove, or reorder navigation items.
3. **Use vs. Configure.** Global Settings contains account, appearance,
   notification, privacy, and workspace-general preferences. A product's daily work and its
   product-specific configuration stay together under that product's stable
   contextual navigation. Every new feature must pass this ownership test before
   it is added to the root rail, a product sidebar, or global Settings.

Projects passes Use vs. Configure because its primary user intent is daily work
selection: users choose which Project an Agent should work in, start new local
sessions in that Project, and see whether the current computer can run it.
Creating, renaming, connecting, and removing Projects are supporting actions
inside that product home. Projects would belong in Settings only if it were a
low-frequency repository configuration table with no direct role in starting
or directing Agent work.

### Public landing entry

The public landing route resolves an authenticated visitor's last-selected
Organization entry once while loading the page. Authenticated header and CTA
links enter that Organization route; the app-shell Setup Studio gate redirects
accounts that have not completed the current onboarding version before exposing
the requested product page. Completed accounts continue directly. Anonymous
links go to `/login`. The account preference is only an entry preference for
routes that do not already select an Organization. Auth returns this durable
account preference through the existing session read, so Web must not add a
second entry-preference fetch. Do not send authenticated
landing visitors through the anonymous login guard or create a browser cache
that competes with canonical Organization scope. The Organization route still
revalidates its authoritative scope and fails closed when access is missing.

`/add-to-slack` is the stable public entry for the Slack acquisition funnel.
Anonymous visitors return to that same route after authentication; authenticated
visitors continue to the last-selected Organization's Organization picker
with the `slack-install` intent. The picker lists only non-personal
Organizations and lets the user create a new Organization; when no eligible
Organization exists, the funnel goes directly to new-Organization creation.
The intent changes only the post-selection or post-creation destination to
**Center Agent → Channels**. The public funnel and picker do not inspect Slack
connection state or start OAuth. An incomplete account enters Setup Studio,
where the Channels step may offer the existing Slack OAuth flow. A completed
account continues to Center Agent → Channels, which owns connection status and
keeps **Add to Slack** as the user's explicit installation confirmation.

### Public Changelog

`/changelog` is the canonical public Web view of published OpenMeld updates.
It is discoverable from the public landing footer and does not enter the
authenticated app shell or Organization navigation. It shows newest-first
publication dates, optional release names, public outcome Markdown, change kind,
and product areas, then loads older entries only through an explicit action.

The page calls the shared anonymous `GET /v1/changelog` contract through a Web
server function. Core remains the validated GitHub reader; Web never imports a
build-time copy, stores a second archive, or manufactures publication state. A
source failure renders an explicit unavailable state with one retry action and
no stale or model-authored fallback.

### Workspace switcher

The top of the rail contains the only workspace-switching surface. Its order
and actions are fixed:

1. the personal workspace, pinned first
2. the member's Organizations
3. **Create organization**, which opens a one-field name form; Auth returns the
   generated Organization URL
4. **Manage organizations**, which opens the full-page Organization manager
5. a separated **Settings** utility, which opens **Settings → Personal →
   Account** for the current workspace

No page-level Organization picker or second context switcher may compete with
this control.

For `/o/{orgSlug}` routes, the URL selects the current tab's Organization after
the route loader freshly confirms that the signed-in account is a member. The
Auth-owned account `lastSelectedOrganizationId` is the default entry preference
for routes without an explicit Organization. A valid Better Auth Session active
Organization remains only a backward-compatible recovery preference. Neither is
the authority for an Organization URL, and neither needs to match it.

Organization switching, creation, invitation acceptance, join-link acceptance,
and membership recovery navigate to the selected Organization without writing
Better Auth Session state. They must not call `organization.setActive`. An
explicit workspace-switcher selection writes only the Auth-owned account entry
preference before navigation. Explicitly selecting the Organization already in
the current URL still writes the preference but does not navigate again. This
keeps tabs independent: one signed-in browser may use different Organizations
in different tabs without either tab changing the other's current request
context, while the most recent explicit selection becomes the next browser or
device's entry Organization.

Web request modules make this distinction explicit: an Organization-route
request constructs the Organization-scoped API foundation with the
route-resolved Organization id (or the route slug while the id is not yet
available). Account, device, public-link, and resource-identity entry points use
the separately named unscoped foundation. A single factory with optional
Organization fields is forbidden because an omitted field would silently
reinterpret an Organization route under Session state.

This requirement also covers Organization-owned mutations sent directly to
Auth rather than through Gateway. Web must send the same standard requested
Organization selector, and Auth must resolve it through its shared verified
membership resolver. A direct Auth endpoint is not permission to recover the
Organization from Session state. Agent Profile creation is the canonical
example: creation, Binding, Default Project, and optional Space join all carry
the one route-resolved Organization id.

Agent Profile creation defaults follow the same boundary. Their query and
mutation keys include the route-resolved Organization id and canonical Agent
Controller ref. Web must not recover either value from mutable Session state,
and changing Local Agent must replace the draft from that controller's own
validated defaults rather than reuse the previous controller's form state.

When the scoped foundation is constructed from a route slug, that slug remains
authoritative even if a downstream API method also supplies an actor request
context containing another Organization id. The transport sends exactly the
route selector; it never combines or replaces it with mutable Session or actor
state.

Selection failures cross Auth and the Web proxy in the shared Gateway error
envelope. The Web API client preserves the bounded error code and natural
message; the switcher renders only that message and never a raw upstream JSON
body.

Every Organization-scoped Web API request carries one untrusted requested
Organization selector. The route's resolved Organization id must be bound to
the query or mutation that owns the request and must not be inferred from
mutable global browser location when the fetch starts. This keeps intent
preloads, delayed retries, and in-flight requests attached to the same
Organization as their query key. The Web proxy forwards only the requested
selector and must strip any browser-supplied authoritative active-Organization
header. Gateway and Auth verify current membership and produce the trusted
active Organization claim used downstream. The client never manufactures that
claim. A missing or mismatched membership fails closed, while browser query
persistence remains only a read acceleration after successful route
authorization.

### Fixed primary rail

The rail places the current workspace switcher at the top and has no separate
OpenMeld brand row or account entry. **Home** is the first destination. The
remaining seven product destinations are organized into three fixed,
user-collapsible groups:

- **Home** — the current Organization's adaptive overview and product entry.
- **Work** — **Spaces**, **Direct Messages**.
- **Team** — **People**, **Agents**.
- **Resources** — **Projects**, **Documents**, **Agent Activity**.

In the full rail, each labeled group uses its heading as an accessible
disclosure trigger and restores the browser's collapsed groups from the same
browser-wide layout preference as the rail width and tier. **Home** and the
bottom utility area never collapse. Compact and icon-only tiers keep every
destination visible because those tiers do not render group headings or a
disclosure trigger; returning to the full tier restores the remembered group
state.

The destinations resolve in that group order:

1. **Home** — the current Organization's concise overview. It leads with the
   designated Center Agent, then composes existing Agent Activity, Inbox, Tasks,
   Spaces, People, Agents, Projects, Documents, and current-Computer projections. It
   owns no parallel state or mutation path. Its Center Agent action opens the
   canonical compact Center Agent conversation, and every other item links to
   its existing product home.
2. **Spaces** — the current workspace's Space collaboration surface.
3. **Direct Messages** — the current workspace's private one-to-one
   conversations. Its canonical routes are `/o/{orgSlug}/direct-messages` and
   `/o/{orgSlug}/direct-messages/{spaceId}`. The Direct Messages secondary
   sidebar lists current DM Spaces by the other participant's profile identity;
   selecting one opens the existing Space conversation surface in the content
   region. Direct Messages are a first-level Web destination, not a child group
   inside the Spaces sidebar, and this presentation does not create a separate
   DM data or messaging subsystem. People and Agents entry points navigate
   straight to this route family after opening or reusing the DM. Its pending
   state uses Direct Messages geometry and never flashes the Spaces sidebar.
   Canonical classification reads the Space status projection; the Account
   Space Index is list data and cannot override a fresher status result.
4. **People** — the first-level home for the Human teammates in the current
   workspace. Its secondary sidebar lists Human Profiles and owns the
   **Invite Members** button. Selecting a person opens the full Human Profile
   detail as the main content, including that person's Computer cards. Inviting
   remains role-gated. The personal workspace shows the current member and the
   existing create-Organization guidance instead of pretending that invitations
   are available there.
5. **Agents** — the first-level home for ordinary Agent Profiles that members
   manage. User-facing management copy calls them **Agents**; `Agent Profile`
   remains the internal identity-model term. The page shows each Agent's
   identity, owner visibility, authoritative readiness, and execution
   relationship in plain language such as **Uses Codex on Felix's MacBook Pro**.
   The managed Center Agent remains in the separate Center Agent product home.
6. **Projects** — the first-level home for choosing, creating, and connecting
   the code Projects used by local Agents. Project records are scoped to the
   selected Organization; local folder connections remain owner-self,
   device-local execution facts.
7. **Documents** — the Organization-scoped Markdown home for the
   Organization Brief, Profile Reports, and shared knowledge, organized into
   nested folders. It has no secondary sidebar; the current folder's child
   folders and files live inside the page itself.
8. **Agent Activity** — the first-level home for local coding-agent session
   visibility. Its canonical route is `/o/{orgSlug}/agent-activity`; the full
   label prevents confusion with human activity and the Center Agent Audit Log.
   Its secondary sidebar groups **Overview**, **Sessions**, and **Changes** under
   **Monitor**.

**Settings** remains a utility rather than a product peer. Its persistent main
sidebar entry is the final footer item after **Toggle Sidebar**, without a
dedicated divider or separate visual section. The workspace switcher also links
to the same destination from a separated utility row after its Organization
actions. Both entries open **Settings → Personal → Account**; they are two
entry points to the one global Settings surface, not duplicate account or
Settings implementations.

**Computer**, **Center Agent**, and **Inbox** are intentionally not primary rail
destinations. The app canvas owns a bottom global control row outside the inset
surface. The current Computer launcher sits at the far left, adjacent to the
primary rail, and opens that exact Computer's detail without an inventory
interstitial. Center Agent and Inbox remain together at the far right. The
Computer launcher reflects the current Computer's coarse state; it never
replaces Core-owned readiness truth or claims that an Agent can reply. When no
current Computer exists, it opens the normal setup flow.

The global Center Agent surface has no secondary sidebar. Its persistent header
navigation is exactly **Messages**, **Graph**, **Files**, **Tasks**, **Routines**,
**Skills**, and **Apps**, in that order. Messages, Graph, and Files preserve the
canonical Center Agent conversation surface; Tasks owns durable parallel work,
its read-only board, and conversation-first detail. One compact header menu
preserves **Channels**, **Memory**, and **Center Agent settings**. The
conversation variant of that menu also preserves **Conversation information**.
There is no separate About surface or Slack shortcut; Center Agent identity,
model, status, and Slack management remain available through Center Agent
settings and Channels.

The Inbox launcher is present across ordinary authorized routes, shows only the uncleared,
unresolved action-required count (visually capped at `99+`), and opens a compact
preview first. The preview shows unread context and a bounded list of recent
items grouped as **Needs action** and **Recent updates**, preserves source
navigation and read-on-open behavior, and exposes a clearly labeled maximize
action to `/o/{orgSlug}/inbox`. One group does not hide the other. Its width and
height must remain usable in narrow viewports. Ordinary unread updates never
inflate the launcher badge. The far-right global control group contains a Center Agent
launcher plus a fixed-width, horizontally scrollable strip of active and
action-required Task shortcuts. It never replaces overflow with a hidden `+N`
count. Each Task shortcut opens the exact canonical Task preview, maximizes to
the exact full route, and may be dismissed without deleting or stopping the
Task. Only Needs action adds a persistent amber dot; ordinary active work adds
no label, badge, or looping animation. The shortcut for the Task already shown
in full detail is hidden. A visible shortcut remains through the final result
until the requester dismisses it, while historical finished Tasks are not
backfilled into the strip. The Center Agent launcher is hidden while full Chat
is open. Elsewhere its compact view mounts the same `CenterAgentPage`,
`SpaceLanding`, conversation timeline, live Agent stream, Stop control, and
Space composer used by full Chat. Sending stays in the compact view and writes
directly to the canonical Center Agent Direct Message. Maximizing unmounts the
compact owner before the full route mounts, so Web never runs two live-stream or
writer owners for that conversation. Inbox, Task shortcuts, and Center Agent
are separate controls and truths, and at most one compact panel is open at a
time.

### Center Agent Tasks

The canonical list route is `/o/{orgSlug}/center-agent/tasks`; Task detail is
`/o/{orgSlug}/center-agent/tasks/{taskId}`. Both run inside the Center Agent
pathless layout and secondary navigation. They require current Organization and
Task access before rendering content or mutations.

The Tasks page reads Core's authorized projection and groups cards as
**Active**, **Needs action**, and **Finished**. The board is read-only: drag,
drop, local reordering, and card movement never mutate Task state. Narrow
viewports preserve the same groups in a list presentation. Failed and stopped
Tasks stay in Finished with explicit outcome labels. Task cards use the shared
Fluid layout background for hover and focus, retain the shared Card surface
background, and keep a structural inset border; they do not use the Card
primitive's outer ring where a containing conversation surface could clip it.
Current Web calls request the shared Task response contract v2 on every list,
detail, and mutation route. An unversioned request is a frozen v1 compatibility
path for older already-loaded Web documents; current Web never falls back to v1
or reconstructs Task phase locally.

Task detail reuses the existing conversation primitives, Markdown renderer, and
composer while its header explicitly labels the surface as a Task and presents
status, origin, and state-aware controls. Its composer appends to the canonical
Task event stream. Requester and Center Agent messages use the same aligned
message and bubble primitives as the main conversation; lifecycle-only events
remain compact status rows instead of pretending to be messages or Cards. It
shows durable product events, never raw reasoning, private runtime transcript,
tool payloads, commands, paths, or internal Agent discussion. Phase 1 exposes
Stop while work is active, Retry after failed or stopped work, and a follow-up
composer after completed work. A completed follow-up starts a new attempt in the
same Task Context. Recover result and Recover reply remain hidden until the exact
Core recoverability projection and mutation contract exists.

Remote Agent runtime generations are not a Web concept. If Core rolls the
stable Task Context to a fresh generation, Task detail remains on the same URL
and renders no rollover marker, replacement-Task action, or context-management
instruction. If automatic continuation exceptionally fails, Task detail keeps
Retry and diagnostics available and describes only the failed continuation,
not the internal history limit.

For a Slack, Lark, or Feishu-originated Task, detail states that replies also
return to the original provider conversation before the composer. Web never
retargets that frozen publication destination implicitly.

Center Agent Chat and other OpenMeld conversations render a compact Task card
when their accepted request creates a Task. The card uses the canonical Task
projection and links to exact detail. It does not own lifecycle state or turn the
source conversation into Task Context.

The compact Task preview and full Task route use the same Query keys, revision
rules, Task conversation component, and Task composer. The compact surface shows
the conversation directly instead of wrapping a latest update inside another
Card, and sending never navigates away. Compact and full Center Agent Chat render
the same canonical
Direct Message controller and Space composer, but never at the same time:
opening full Chat hides and unmounts the compact launcher. Maximize preserves
the exact Task location. Multi-tab and reconnect behavior treats live frames
only as refresh signals and re-reads Core.

The Home outer-rail destination independently shows a static amber unread dot
for final replies in the current member's Center Agent Direct Message. Core
excludes converted Direct Messages from this summary; their unread replies
activate only the Spaces destination that now owns the conversation. Full rails
place the Home dot immediately after the label; compact and collapsed rails
attach it to the icon corner. Web clears this projection only after the Center
Agent conversation is visible and held at the latest message for the read
debounce, then writes the Core-owned monotonic read-through watermark. Inbox
deep links include the exact source Signal selector so opening an item returns
to the relevant reply instead of merely opening the conversation root.

The Spaces secondary sidebar consumes the Core-owned grouped unread Space
message summary alongside the Account Space Index. It shows one static amber
dot and an accessible unread label on visible Space rows. Unpinned unread Spaces
appear first by newest unread Signal occurrence; pinned order remains member-controlled.
The Direct Messages secondary sidebar consumes the same Core-owned grouped
summary and shows the indicator on the exact unread conversation row. It does
not derive unread state from route activity or a browser-only counter.
The Spaces destination in the outer app rail consumes the Core summary's
complete `ordinarySpaceUnreadCount` aggregate. It shows one static amber dot
whenever at least one ordinary Space has unread messages, including while the
member is elsewhere in OpenMeld. Its accessible label reports the total unread
ordinary Space message count. Web does not derive this total by intersecting the
independently bounded grouped summary and Account Space Index, and it shows no
dot while an older Core omits the additive aggregate. Full rails place the dot
after the Spaces label; compact and collapsed rails attach it to the icon
corner. The outer dot is an aggregate wayfinding cue only: the Spaces secondary
sidebar remains the surface that identifies the exact unread Spaces.
Each row presents one primary trailing visual status: unread attention first,
then current agent work, then the persistent pin for an otherwise idle pinned
Space. For a row with unread or active work, hover or keyboard focus reveals the
pin action while keeping the higher-priority status visible in the corner. This
lets the member pin or unpin the Space without losing unread or working evidence.
An idle unpinned row shows its date only when the row can fit it. The title and
date share one vertically centered layout with a visible gap; the title truncates
against the date's actual width instead of extending beneath an absolutely
positioned timestamp.
Ambient agent work for other Spaces comes from a successful account active Wake
summary. Immediately before each browser request, Web starts the shared
45-second presentation budget on the browser's monotonic clock. Network time
consumes that budget, and a response arriving after it expires is unusable.
Core's `generatedAtMs` remains integrity and diagnostic evidence; Web never
compares it with a browser wall clock because the hosts are not clock-synchronized.
The request anchor travels with that one successful query result, so navigation,
remounting, or returning to the same cached result cannot move the anchor forward
or revive expired evidence. A later successful poll receives a new anchor even
when its Core summary is structurally unchanged. Server rendering shows no
ambient orb and the browser refetches, because the monotonic anchor is local to
one browser document and is not persisted.
For the open Space, the conversation publishes its final visible Wake progress
projection after merging the Core-derived per-Space summary, detailed progress,
and durable reply signals. The Space shell owns a route-scoped synchronous read
projection that the conversation publishes before paint and the sidebar
subscribes to directly, so a final reply clears an older running summary without
an observer-cache delay even when no terminal progress item remains. Before the
conversation has published that projection, the sidebar merges the per-Space
summary and presentation cache with the same shared Wake identity and lifecycle
semantics, so newer terminal progress still wins over an older active summary.
This shell projection is not persisted and is not a second writer or execution
authority. Terminal or locally expired progress never produces an orb. A failed
account-summary refresh, a missing browser request anchor, or expiry clears ambient
indicators, while the open Space remains aligned with its current conversation
evidence; Web must not keep an old orb visible merely because TanStack Query
retains its last successful account-summary data.
When the active-Wake summary includes target attribution, the existing Working
orb's tooltip and accessible label name the frozen target Agent Profile, for
example `Clico Codex is working`. The Space row itself keeps its compact visual
and generic `agent working` accessibility state; it does not add an always-
visible Agent name. Web may use that same frozen summary name to replace a raw
Profile id in the open Space's detailed progress projection, but it must not let
ambient summary lifecycle override the open Space's newer terminal truth.
Multiple active Wakes use an aggregate count. A missing additive target
projection falls back to `An agent is working`, and a raw `agt_...` identifier
is never user-facing copy. This live indicator remains distinct from a
persisted reply's historical **Work summary**.
Opening a route alone does not clear the indicator. The shared Space message
view writes the same Core-owned per-Space monotonic read-through watermark only
after the document is visible and the member remains at the latest message for
the normal debounce. If the unread summary is unavailable, Space navigation
remains usable in Account Space Index order without inventing read state. Web
treats cursor persistence failure as failure and retries it; a missing Core
Inbox writer cannot be mistaken for a successful write. Main-timeline and
thread Inbox state remain separate: a main-timeline read position cannot clear
a thread item. Implausible future cursor positions are rejected rather than
suppressing future messages. When Web observes a new Inbox item, it invalidates
the full Inbox facts projection so per-conversation indicators and aggregate
launchers refresh from the same Core truth.

Browse Spaces composes the Organization Space Directory with those same
Account Space Index, unread-summary, and active-Wake projections. Joined cards
use one status slot with unread first, Working second, and pinned last. When
unread or Working owns that slot, hover or keyboard focus reveals the shared
pin or unpin action without showing competing status labels. Joined cards
follow pinned order before the unread-aware unpinned order. Discover cards keep
the directory's public-Space order and expose only Join; Web does not attach
account status or pin actions to an unjoined Space.
If a joined directory item has no matching Account Space Index item, Open stays
available while account status and pin controls fail closed.

The **Artifacts** placeholder is not part of the target rail. Remove the
placeholder and return Artifacts to navigation only when it has real product
content and passes the Use vs. Configure test.

The product destinations that own a secondary sidebar are **Spaces**, **Direct
Messages**, **People**, and **Agent Activity**. The Settings utility owns its
own secondary sidebar. **Agents** is an independent full-width home. People
uses its sidebar only to select a Human Profile; the selected Human Profile's
complete detail is the canonical main content, including that person's
Computers. Center Agent is also
a full-width home: its primary work lives in the shared header and its lower-frequency
capabilities and configuration live in one header menu.

Each of those five route families owns one independent browser-persisted
secondary-sidebar width. Child routes and selected records within a family
share that width, as do different Organizations. The preference boundary is the
stable route family, never the full pathname or a specific Organization, Space,
Direct Message, Task, or Settings section.

Every ordinary authenticated app route uses the same inset app surface. The
persistent outer rail remains on the full-window app canvas; a route's secondary
sidebar, main content, and optional right drawer are grouped inside that inset
surface. Documents, Projects, and the explicit Connect route use the same
surface without rendering an empty secondary sidebar. Connect keeps one Back
control at the upper-left edge of its content and does not restore a separate
header divider. Setup Studio and the explicit Start cross-page flow remain
full-screen exceptions.

Responsive presentation preserves that topology while exposing one usable work
plane at a time. At `lg` and wider, the outer rail remains inline and keeps its
current desktop geometry. Below `lg`, the shared app header opens the same rail
as a full-label modal drawer. At `md` and wider, an owned secondary sidebar
remains inline; below `md`, the header opens that same route-family navigation
as a modal drawer and the canonical content receives the full width. These
drawers are transient presentation: they do not write desktop rail width or
tier state, and they must close after an unmodified navigation activation.
Shell controls remain outside the content scroll plane, respect safe-area
insets, expose touch-sized targets, trap focus while open, restore focus when
closed, and remove their transition under reduced motion. Center Agent's Space
header keeps its five primary work tabs and one compact menu available without
reintroducing a contextual drawer. Narrow layouts may horizontally scroll the
tab row, but they must not hide Tasks, Routines, or any menu destination.

### Home and Center Agent Chat

The authorized Organization root `/o/{orgSlug}` is canonical Home and renders
the existing Center Agent conversation directly. Home is not an Organization
dashboard and owns no parallel Inbox, Task, Space, Directory, Project,
Document, or Agent Activity preview.

The outer app rail keeps one **Home** destination and does not expose a separate
Center Agent destination. Home owns the Center Agent conversation's unread
indicator and intent preload. The Center Agent header continues to expose
Messages, Graph, Files, Tasks, Routines, Skills, Apps, and its compact menu;
their explicit `/o/{orgSlug}/center-agent/*` routes remain stable and keep Home
selected in the outer rail.

The legacy `/o/{orgSlug}/center-agent/chat` URL performs one history-replacing
compatibility redirect to `/o/{orgSlug}` and preserves supported conversation
search state such as `focusSignalId` and `view`. No current Web navigation emits
the legacy URL.

### Inbox

The canonical route is `/o/{orgSlug}/inbox`. The bare authorized Organization
route renders **Home** after current membership and Organization identity are
resolved. Inbox remains a lower-priority global utility reached from its
bottom-right launcher; it must not become the default authenticated or
post-onboarding destination. Inbox uses the full-width inset app surface without
an empty secondary sidebar.

The full page is also reached from the permanent bottom-right Inbox launcher's
maximize action. The compact launcher preview reads the same Core list and
summary, uses the same structured source mapping and read mutation, and owns no
parallel unread state.

The page provides **All**, **Unread**, and **Needs action** filters, a compact
high-attention summary, an explicit **Mark all as read** action, and a
chronological Fluid item list. Opening an item starts its idempotent mark-read
mutation as part of the same in-app navigation to the structured source target;
the mutation survives the source route change. Hover, viewport exposure, tab
focus, and browser focus never mark items read. Every row also exposes
accessible read/unread and **Dismiss** actions. Dismiss optimistically removes
the row and updates unread and attention counts, restores the exact prior cache
on failure, and never changes source state. Dismissing a directly linked item
also clears the item selector so Web does not present its deliberate removal as
an availability error.

The optional `?item={itemId}` deep link reads that exact recipient-authorized
Core item by ID, places it in the canonical **All** view when it is outside the
currently loaded list, focuses it, and marks it read once. It never searches a
bounded number of list pages or treats list depth as item availability.

When a Space terminal-failure Signal is visually anchored under its Wake source
message, the Core-owned Inbox target uses that source Signal as `focusSignalId`.
Web focuses the exact target it receives and does not infer a second navigation
target from Space history. Legacy failed-Wake targets without a trustworthy
source anchor open the Space without presenting a false unavailable-message
error.

Unread treatment includes a text or semantic marker and must not rely on color
alone. Urgent and action-required semantics remain separate in copy and icons.
A resolved action remains in **Updates** as history but does not keep the active
`Urgent` label.

An Opportunity Inbox item uses the existing `center_agent` target and opens the
canonical Center Agent Chat. Web does not add an Opportunities route, detail
page, secondary navigation item, inline decision mutation, or client-side
Opportunity store in Phase 1. The member accepts, defers, or dismisses the
Recommendation in ordinary conversation; Core updates only Opportunity truth.
The Inbox item is an ordinary update, so it does not enter the action
badge or browser-notification path. Dismissing only the Inbox row remains a
separate Inbox-owned action and does not decide the Opportunity.

The list uses shared Fluid interaction, focus, color, spacing, and semantic
shape tokens; it does not add a private radius or animation system. Loading,
empty, filtered-empty, error, and offline states remain visually stable and
give one clear next action when one exists.

The Phase 1 client refreshes the Core snapshot with bounded foreground polling
and refetches when the window regains focus. Polling is only a refresh trigger;
the Core snapshot remains the source of truth. Browser notifications are
created only from newly observed Inbox items after the browser grants
permission and while the member has not explicitly turned them off in that
browser. They do not consume, mark, or store unread state. Clicking one opens
the canonical source target for that item directly; Web does not insert Inbox
as an intermediate destination.

### Notification settings

**Settings -> Personal -> Notifications** owns phase 1 delivery preferences:

- **Browser notifications** reflects permission in the current browser and
  explains when the browser has blocked the permission. If permission is still
  undecided after Account Setup Studio, Web presents one browser-local
  introduction that explains the benefit. Only the member's **Enable
  notifications** gesture requests native permission; rendering the app never
  opens the browser permission prompt. An existing browser grant defaults this
  setting on unless the member has explicitly turned it off. **Not now** only
  dismisses the introduction for that member in that browser, and Settings and
  Space Info remain the durable discovery and control surfaces.
- **Email for urgent items** is a durable account preference, enabled by
  default, and may be disabled without hiding Inbox items.

Phase 1 intentionally has no per-source switches, schedules, quiet hours,
digests, snooze, Slack delivery, closed-browser Web Push, Desktop, Mobile, or
CLI controls.

### Settings structure

The Settings secondary sidebar always shows these two groups:

- **Personal** — **Account**, **Appearance**, **Notifications**, **Privacy &
  Safety**, and **Send feedback**.
  The routed settings are account-scoped surfaces and do not change when the
  selected Organization changes. Privacy & Safety links to **Center Agent →
  Memory** for the current workspace's member-memory erase action and lists the
  signed-in member's Computers for Computer file access. Both operations stay
  on their canonical product surfaces rather than creating duplicate settings
  state. Send feedback is an account-level utility action immediately after
  Privacy & Safety. It opens the existing feedback dialog rather than creating
  a route or a second submission contract.
- **Current Organization name** — **General**. The visible group label is the selected
  Organization's stored name, including for the personal Organization; it is
  never the generic label `Workspace`. Every member can see these surfaces;
  each mutation is shown and enforced according to the member's role. The group
  label also displays the current `member`, `admin`, or `owner` role badge.

**Settings → Personal → Appearance** owns the browser-local interface corner
style. The two current choices are **Square** and **Rounded**. Rounded is the
default and uses Linear's standard `8px` control radius; Square is available
when a user explicitly chooses the sharp-corner presentation. Web restores the
selection on the document root before the app renders, applies the same preset
radius to shared Fluid geometry through `ShapeProvider`, and synchronizes
changes across tabs. Product components do not read this storage value or
maintain their own radius setting. The preference is browser-local, not
Organization state, and a future custom pixel option flows through the same root
token and provider radius rather than adding component-specific values. The
Rounded-default rollout uses a versioned browser preference key so existing
users receive the new default once; a Square selection made afterward remains
explicit and persistent.

Appearance also owns the browser-local **Your messages** placement used by
every Space, Direct Message, Center Agent, thread, and Task conversation that
renders the shared message primitives. A message placed on the right uses a
trailing-aligned, content-sized bubble with a responsive maximum width; a
message placed on the left uses the full available transcript width. Both
placements keep their content leading-aligned and give the current member's
messages the same muted, semantic-radius surface used to highlight any message
on hover or keyboard focus. With right placement, the full transcript row stays
available as the hover and focus target, while the visible current-member
surface and its actions stay anchored to the bounded bubble. With left
placement, that surface remains full width. Agent and other-member messages
remain transparent at rest and use the full-width row highlight. Product
surfaces declare current-member authorship once and must not reimplement
placement, width, text alignment, resting background, action placement, or
highlight geometry locally.

**Settings → Personal → Account** and the signed-in member's **Edit Human
Profile** dialog in People are the two Account Display Name editing surfaces.
Both call the shared `PATCH /v1/account/display-name` contract; neither calls
Better Auth's generic user writer or sends a second Human Profile mutation. The
same Web mutation is reused by the first-run name screen. Other members never
receive the edit action. On success, Web invalidates the session, all
account/Human Profile lists, and Organization directory projections so every
visible copy reloads the Auth-owned paired value. Auth refreshes the
session-data cookie in the mutation response before those reads run.

The Account profile card and Personal workspace avatar in the Organization
selector present the signed-in user's default Human Profile with the same
`DitherProfileAvatar` identity used elsewhere in Web. They resolve that Profile
through one default-Human query contract and accept only an active Human Profile
whose `isDefault` flag is true. Its seed uses the resolved Human Profile ID,
never the Auth user or personal Organization ID, and an uploaded Human Profile
image comes from the canonical Account avatar query, never the signed session
projection. If that Profile is unavailable, these surfaces retain their generic
avatar fallback without generating Dither artwork. Ordinary Organizations keep
their own logo or name fallback.

The Account profile card owns upload, replace, crop, and remove controls for
that default Human Profile image. Hovering or focusing the avatar reveals its
Add/Change action; an uploaded image also reveals the shared top-right remove
action. The card does not repeat those actions or file-format guidance in a
separate right-side column. Web sends the normalized image through the shared
Account avatar contract, applies the returned `avatar` value to the existing
canonical Account avatar, session, Profile, Organization Directory, and loaded
Space member/bootstrap query projections, then invalidates those projections.
The canonical Account avatar query is the Web read authority; the session image
is compatibility data only. A loaded Space member with `avatarUrl: null` is an
authoritative removed-avatar projection; message rendering must not fall back
to a historical per-signal avatar in that case. It must not write a second
avatar field or keep a card-local successful avatar after the owner projections
reload. The controls fail closed when the active default Human Profile is
unavailable.

**Center Agent → Center Agent settings** owns Center Agent configuration. It
contains Model, Usage, the Audit Log, and the reversible
Organization-wide operating control in **Danger Zone**. Only the immutable
Organization creator may pause or resume the Center Agent; owner/admin roles do
not grant this authority. The active state presents **Pause Center Agent** and
requires a confirmation that pausing stops every current task across OpenMeld,
Slack, and connected Channels and rejects new tasks. The paused state presents
**Resume Center Agent** directly and never sends the user through setup or
reconnection. Pausing preserves identity, conversations, Routines, Channels,
Apps, Bindings, and settings. Other members see why the control is unavailable.
The Audit Log is the Center Agent action journal and is readable by every
workspace member. It includes Local Agent requests, bounded context preparation
and reported loads, successful Routine mutations, and supported workspace
actions. When an action is linked to an exact Local Agent request, its summary
uses **Requested by _member_ via _client_**. Direct work never receives a
guessed Local Agent label. It is not Agent Activity and must never be labeled
**Activity**.

The optional Organization working language has no direct Web control in this
release. An owner or admin changes it conversationally through the Center
Agent; members cannot mutate it. Web does not cache, infer, or display a second
preference, and a new Center Agent Web conversation simply follows the current
request language unless stronger current context says otherwise.

The **Model** section is readable by every active Organization member. It shows
the effective friendly primary-model name and never exposes a raw OpenRouter
model id. Owners and admins may choose **OpenMeld default**, **GLM 5.3 Flash**,
**Grok 4.6**, **Grok 4.5**, or **DeepSeek V4 Flash** and save through the
Binding-revision compare-and-set contract; members see the same effective
configuration without enabled mutation controls. The OpenMeld-default option
includes the current effective model so a future system-default change is
understandable without duplicating it into browser state. A model choice's
optional catalog-owned badge appears in both the closed selector and its
matching options; Web does not infer badges from model names or the current
default. Reasoning is catalog-owned at `high` and is not a separate Web control
in this release.

Model behavior details use a compact info Tooltip instead of permanently
expanded copy. It says that images use a vision model, that the selection
applies to new turns only, and that failure does not switch models
automatically. `New turns only` is the concise statement that in-progress turns
keep their admitted model; this settings surface does not enumerate the
auxiliary model or its internal image-description handoff. A stale save reloads
the configuration and tells the admin to review it rather
than overwriting a concurrent change.

The **Model** section in Center Agent settings is the single Web read surface
for the friendly effective model name. It must not infer the model from Agent
Profile directory readiness or retain a stale provider id. The Center Agent's
system prompt receives the same friendly name so a member can also ask which
model is active.

Computers belong to their owners in **People**. The selected Human Profile's
main detail renders that person's Computer cards from Core's team-safe
Organization Computer projection, including a Service-connected Computer with
no Agent Profile yet. Selecting a card opens the existing Computer detail route;
the signed-in member also retains **Add a Computer**. The product does not keep
an intermediate all-Computers inventory page. The signed-in member's complete
inventory and all Computer mutations remain account-scoped. Another member's card and detail
may show computer name, owner, device category, operating-system family/version,
last-seen time, coarse Service state, team-safe local-agent availability, and
visible Agents that use it. A reported local agent may also expose operational
details that help teammates understand compatibility: controller state, native
interface, installed version and update status, launch readiness and install
count, reported model names, native capabilities, last-check time, and
provider-reported Usage Limits. It does
not expose controller accounts, executable or installation paths, launch
arguments, update commands, private skills, local policy, credentials, raw
errors, or mutation controls. A live Service may expose team-safe OpenMeld
Tools component versions and update states; setup commands, hashes, and
owner-only controls remain private.

Each Local Agent renders its `usageLimits` list inside the existing expandable
row. Usage Limit evidence does not create a separate page or make the row expand
automatically. In the collapsed row, a compact summary follows the existing
version and update metadata; its tooltip previews every reported window, and
selecting the existing row reveals a responsive grid of compact Usage Limit
cards in its details. Each card reuses the collapsed summary's circular gauge
and keeps the reset and last-observed times visible without a full-width
progress bar. Owned and teammate Computers use the same shared summary and
accessible gauge component.
A provider with no quantified evidence does not add a collapsed-row badge or
placeholder gauge. Web explicitly opts in to both owner and Organization
projections and refreshes them while People or a Computer detail is active.
A gauge names the limit, exposes its 0–100 used value to assistive technology,
shows the used percentage in text, shows reset and last-observed time, and names
the state so color is never the only signal. The UI derives **Low** when a fresh
available limit is at least 80% used; it does not store a second status or
remaining percentage. Unknown values have no gauge and never appear as 0%,
100%, or unlimited.

The UI keeps multiple provider windows separate and handles offline Computers,
expired evidence, temporary provider failure, permanent lack of support, and a
supported provider that has never returned evidence. Last-known percentages on
an offline or expired Computer are **Stale**. A temporary first-read failure is
**Unavailable**; no native provider source is **Unsupported**. Copy states that
capacity information does not control whether the Local Agent can run.

Owned and teammate Computers reuse the same Computer summary, **OpenMeld
Tools**, and **Local agents** presentation components. Web applies visibility
and capability conditions to those shared components instead of maintaining a
second teammate-only card hierarchy. A teammate Computer summary names the
reported local agents through the same exact logo strip, accessible names, and
tooltips used by an owned Computer rather than a teammate-only text label or a
generic count. Its Local agents rows retain the same logo, disabled Switch, and
expandable detail layout. The expansion reuses the owner's operational detail
rows and conditionally omits private fields. Accounts, executable or
installation paths, launch arguments, update commands, private skills,
owner-only actions, and Agent Profile lists remain absent.

An Organization Computer summary uses the concise status label **Computer
offline**. Its
detail diagnostics keep the precise **OpenMeld Service is not connected**
language so the owner knows which product component needs recovery. Both
surfaces derive the tone and state from the same Organization Computer
projection; copy brevity never creates a second status source.

Connecting a computer, understanding which supported local tools it provides,
and repairing that execution path are prerequisite product jobs rather than
appearance or account preferences. Agent readiness remains separate and
authoritative; a connected Computer must never be presented as proof that an
Agent can reply.

On the exact current owned Computer, each enabled reported local agent may show
**Change installation** when the live Service advertises installation
management. The action sits beside the **Launch check** value in that local
agent's detail rows instead of creating a separate Installation section.
**Launch check** is the second detail row after **Controller** and names the
selected installation source and version when more than one verified choice
exists. The collapsed row names that same selected source beside the version so
people never need to infer an installation from a version number. The dialog
lists only locally verified choices, clearly marks the current choice, stages a
new choice without changing it, and requires an explicit **Use ...**
confirmation before it updates the Service-owned local registry. Long paths
truncate inside a width-bounded dialog rather than overflowing the viewport. It
loads on demand, never blocks setup, and never appears for another member's
Computer. When a confirmed change outlives the Web request budget, Web
reconciles the Service-owned selected installation before it reports a failure;
a transport timeout alone is neither shown as the result nor treated as a
rejected change.

A local agent that the owner turned off remains visible as a muted row. It does
not show activation copy, repair guidance, version advice, or an attention
status, and a problem reported only by that disabled local agent does not create
Computer or sidebar attention. Its last reported diagnostic details may remain
available when expanded. When an enable or disable request outlives the Web
request budget, Web reconciles the canonical Service-backed catalog before it
reports a failure; a transport timeout alone is not a rejected change.

The current Computer detail includes **File access** after **Local agents**.
It is an optional, account-owned control for OpenMeld-started runs on that
Computer, with **Use each local agent's settings** as the unchanged default,
**Only selected folders**, and **Block selected folders**. The selected-folder
modes first offer **Choose folders on this computer** when the exact live
Service advertises Local Folder Picker. The Service opens the operating system's
folder chooser on that Computer; the browser does not use a file-upload control
and never receives folder contents. Selection only adds exact paths to the
unsaved draft and does not save the policy.

**Add from Projects** remains a secondary shortcut and reuses the current
Computer's existing Project discovery and Fluid multi-select interaction for
available connections and verified candidates. The Project list and local check
start only after the owner opens that picker. **Enter folder paths manually** is
the final route for an arbitrary folder or a Service without native selection.
All three routes update only the same unsaved draft and use one explicit **Save**
action. Copy states that direct use of local agents is unchanged and that an
unverifiable active boundary pauses only the affected Wake for the Computer
owner's decision.

The control renders only for the exact current Computer whose current live
Service projects support for both policy reads and writes. An older or
incompatible Service leaves that optional projection absent, so Web hides the
control without issuing a policy request or interrupting any existing workflow.
Historical Computers and another member's Computer directory detail never
issue the policy read or show local paths. Web keeps the response in the
account-scoped in-memory query cache only; the browser persistence allowlist
must exclude it. Web forwards reads and writes through the current-device
contract and never invents a saved state when the Service is offline,
capability-mismatched, or addressed as a different device.

**Settings → Personal → Privacy & Safety** is the account-owned discovery
surface for this control. It lists only the signed-in member's personal Computer
inventory, never another Organization member's directory projection. The exact
current capable Computer links to its canonical Computer detail and focuses the
File access card. Other owned Computers remain visible with guidance to open
OpenMeld on that Computer; Web does not imply that their local policy can be
managed remotely. This page never reads, stores, or edits a policy itself.

The **Usage** section on **Center Agent → Center Agent settings** is a read-only
Organization overview available to every
active member. It shows today's Organization-wide Center Agent wake admissions,
the next UTC reset in both local and UTC time, and one current Routine count
against the shared 50-definition limit. It does not present separate enabled and
total quotas because every definition may be enabled. It reads the Core-owned
projections through the shared Web → Gateway → Core contract and does not introduce usage
history, export, per-user attribution, administrator controls, token counts, or
billing concepts.

For a non-personal Organization, **Settings → General** shows the current
Organization logo as a separate autonomous section before Organization
identity. Every member may see the logo; only the current owner sees enabled
upload, replace, and remove actions in the initial release. The client may crop
and normalize a local preview for usability, but Gateway remains the
authoritative decoder and transformer. A successful mutation writes the
returned Better Auth `organizations.logo` projection into the current
Organization scope before reloading the route, so the settings page and
workspace switcher update immediately without maintaining another avatar state.
The personal workspace does not render this section and continues to use the
current account avatar.

For a non-personal Organization, **Settings → General → Information
protection** is visible only to an owner or admin. Web must resolve the shared
Better Auth role permission before mounting the section; members do not render
the section and do not issue its read request. The bounded textarea describes
categories or document types, warns the admin not to paste credentials or the
sensitive records themselves, and uses an empty save to clear the optional
policy. Copy must state that built-in protections always apply, ordinary reads
and authorized actions remain available, and the policy adds no confirmation
step. Core remains the policy and authorization owner; browser query state is
only a cache.

### Account Setup Studio

The app shell gates every authenticated account that lacks the current
versioned onboarding completion record and routes it to
`/o/{orgSlug}/onboarding`. This includes existing accounts when a new
onboarding version first ships. The gate is account-scoped and sits above the
ordinary shell, so Organization creation, email invitation acceptance,
join-link acceptance, direct navigation, and refresh all converge on one entry.

Setup Studio is a full-screen split layout. Its local progress record contains
only current step, selected Organization id, completion timestamp, and intended
return route. Auth/Core/Gateway data remains authoritative for every displayed
setting. Completing or skipping returns to the original requested feature,
rewritten to the selected Organization. Directly opening the route starts a
safe re-run over the same real data; `?restart=1` is the deterministic local
debug reset for presentation progress.

The ordered steps are Organization, Channels, Apps, this computer, defaults,
invite, and ready. Detailed product semantics live in
`developing/product/onboarding.md`. Web-specific boundaries are:

- pending email invitations use Better Auth's current-user invitation list and
  existing acceptance mutation;
- Organization join flows update route-scope caches optimistically without
  writing Better Auth active-Organization session state. Creation waits for the
  Auth-generated slug because Web cannot invent a truthful provisional URL;
- Slack, Lark/Feishu, Apps, connector requests, Prepare, memory, Wake access,
  Organization documents, Information Protection, and invitations reuse their
  existing query keys and mutations;
- role-gated sections do not mount unauthorized reads;
- mutations update the owning cache first and restore the exact prior value on
  failure; server-generated invite-link tokens remain pending until Auth returns
  the real URL;
- the result screen is assembled from confirmed memory-policy, Channel, App,
  local-runtime, local-agent, and invitation projections.

The former blocking `OrganizationEntryOnboardingDialog`, its two steps, local
hook, and tests are removed. Wake access and Organization memory are no longer a
separate consent corridor: untouched values default on in Setup Studio,
explicit prior choices remain authoritative, and the same settings remain
available in their normal management homes.

### Retired and relocated surfaces

**Directory** is retired as a user-facing container. Its People and Agent
Profile leaves move to the first-level **People** and **Agents** homes. The
former `/o/{orgSlug}/directory`, `/directory/people`, `/directory/members`, and
`/directory/agents` routes are redirect-only compatibility entries. They must
not render a Directory header, Directory sidebar, or a second mutation surface.

**Settings → Personal → Computers** is also retired. Former detail URLs redirect
to the canonical Computer detail route while preserving the device id and
supported `focus` / `refresh` route state. The legacy `/computers` entry opens
the current Computer directly, or People when no current Computer exists; it
must not render an inventory picker. Settings must not keep a Computers
navigation item or render the computer management surface.

The seven-tab **Manage Center Agent** panel is retired as one concept. It must
not survive as a hidden route, a personal-only implementation, or a parallel
configuration surface. The product-semantic relocation for each former tab is
owned by `developing/product/organizations-and-center-agent.md`.

Audit Log and Agent Activity remain different products:

- **Audit Log** records Center Agent tool calls and lives under
  **Center Agent → Center Agent settings**.
- **Agent Activity** shows local coding-agent session activity and lives in the
  primary rail at `/o/{orgSlug}/agent-activity`.

The audit journal must never be renamed **Activity**.

### Personal workspace parity

The personal workspace and a multi-member Organization use the same root rail,
Center Agent header navigation and menu, and Settings structure. Differences
are content-level only. In the
personal workspace, **People** shows the current member plus an
invitation guidance card. The card explains that collaboration requires an
Organization and links to **Create organization** instead of attempting an
invitation. **Settings → General** uses personal-workspace-appropriate
danger copy and actions.

Personal-only route guards and hard redirects, including the current
`allowPersonalAgentActivity` pattern, are retired in the target state. A role or
workspace kind may gate an action, but it must not remove a destination or send
the user to a different feature home.

### Navigation delivery history

W-NAV0 documented the six-slot design. W-NAV1 through W-NAV5 delivered it in
this order:

1. **W-NAV1 — additive rail changes.** Promote Agent Activity to the
   primary rail, remove the Artifacts placeholder, add direct Create and Manage
   organization switcher actions, and delete dead navigation code.
2. **W-NAV2 — Settings structure.** Introduce the **Personal** and dynamically
   named current Organization groups.
3. **W-NAV3 — Center Agent management retirement.** Add the About panel,
   consolidate Center Agent-owned surfaces under its contextual sidebar, and
   remove the seven-tab panel.
4. **W-NAV4 — Directory consolidation (superseded 2026-08-05).** Merge Profiles and Organization
   Directory into **Directory → People | Agent Profiles**, then remove the
   Organization rail destination and the `/organization` route tree.
5. **W-NAV5 — personal parity.** Make the personal workspace structurally
   identical, remove personal-only route redirects, and close remaining
   content-level parity gaps.
6. **W-NAV6 — Center Agent progressive disclosure.** Remove the contextual
   sidebar; keep Tasks, Routines, Skills, and Apps in the conversation header;
   move Channels, Memory, and Center Agent settings into one header menu; and
   retire the redundant About surface and Slack shortcut.

The temporary Organization rail destination was removed in W-NAV4. The
2026-07-27 consolidation also removes root Routines and the former
`/settings/{center-agent,channels,apps,memory,usage}` leaves. Because the product
has not launched, retired routes are deleted directly without redirects or
compatibility shims, and all maintained internal links move in the same
cutover. Projects follows the same Single home rule:
when its first-level home ships, the old Agent Activity management entry point
is removed in the same cutover.

The 2026-08-05 first-level object migration supersedes W-NAV4's user-facing
Directory placement. It preserves the existing Human Profile, Agent Profile,
Organization directory, Binding, readiness, and local-runtime owners while
giving People and Agents canonical product homes. Computers remain canonical
objects and detail routes, but their discovery surface belongs to each owner in
People rather than to a separate rail destination.

## Product Responsibilities

OpenMeld Web owns the browser experience for:

- Space list, Space entry, message timeline, and thread presentation
- the fixed workspace switcher, primary rail, People, Agents, current-Computer toolbar launcher, and Settings topology
- the Projects page and owner-self current-computer connection presentation
- Human and Agent Profile collaboration surfaces
- Wake and Reference authoring affordances
- per-target Wake details and waterfall presentation
- Diagnostic Report entry from a visible Space problem
- setup handoff entry and setup command generation
- Slack workspace installation and connection-result presentation
- hosted Center Agent reply-stream presentation and reconnect recovery
- Center Agent member-memory wipe and organization-memory policy controls
- Wake availability and reply-recovery presentation
- sanitized browser-side diagnostic pointers

This is product-surface ownership, not authority ownership.

### Organization Message Channels

**Center Agent → Channels** is the single
management home for Slack, Lark, and Feishu. One Organization may show all
three connected at once. Each provider card reads its own canonical Core
connection projection and offers only that provider's connect, repair,
reconnect, or disconnect actions. One card never infers another card's status,
and connecting one provider never replaces the Organization's designated
Center Agent or another provider connection.

The destination also remains visible in a Personal Workspace so a new user can
discover Channels without first understanding OpenMeld tenancy. In that
context, Web shows Slack, Lark, and Feishu as discovery cards with
`Organization required`, explains that the Personal Workspace is for one
person only, and provides one primary **Create organization** action. That
action opens the existing new-Organization form with Slack-install intent so
successful creation lands directly on the new Organization's Channels page.

Web never renders Add to Slack, manual Slack connection, Lark/Feishu connect,
resume, restart, repair, poll, or management actions in a Personal Workspace.
The only Lark/Feishu mutation available there is **Disconnect** for an existing
historical connection; its cleanup-only confirmation cannot start, resume, or
repair registration. A disconnected provider returns to the ordinary
`Organization required` discovery state.
The Add to Slack Organization picker excludes Personal Workspaces; an account
with no eligible Organization goes directly to new-Organization creation. Core
enforces the same boundary for every write entry point, including OAuth state
creation and callback installation. This is a tenancy invariant, not a route
visibility shortcut.

If the read projection exposes the one known pre-launch Personal Slack binding,
Web labels it `Move required` and explains the supported recovery: create an
Organization, connect the same Slack workspace there, and confirm the existing
informed move. Web does not migrate Personal Spaces, Apps, Agent Profiles, or
memory. There is no generalized historical-data migration because the product
has no external production users; the known internal binding must be moved
before the enforcing release is deployed.

If the read projection exposes a historical Personal Lark or Feishu
connection, Web labels that provider `Disconnect required`. The user confirms
**Disconnect**, then creates or opens an Organization and connects the provider
there as a new Organization-owned setup. Lark and Feishu do not have Slack's
informed move protocol, so Web never promises an automatic move or preserves a
live Personal connection without a cleanup path.

The page introduction uses the current workspace context as its eyebrow
(`Personal workspace` or `Organization`), one **Channels** heading, and one
plain-language description explaining that Slack, Lark, and Feishu are places
where people can message the Center Agent and receive replies. Provider cards
form a responsive grid, and each visible card directly explains that people can
message the Center Agent from that provider and receive replies in the same
conversation. Each card keeps provider identity and status in its header and
centers this plain-language explanation in the card body.
Status badges are the visible connection state, so cards do not repeat
"Connected" or "Not connected" as body copy. Provider-specific setup guidance,
such as Lark Webhook verification or repair guidance, appears only after setup
starts or when a real connection state needs explanation. An idle disconnected
card does not expose setup mechanics or repeat the action already named by its
Connect button.

The card lifecycle is the shared closed status union:
`pending_registration`, `credentials_received`, `configuring`, `connected`,
`repair_required`, `revoked`, and `disconnected`. Web derives connected
presentation from that value and does not keep a second local boolean. Cards may
show the bounded external account, transport, granted capability groups, last
verification, and actionable reason. They never receive or render App Secrets,
verification tokens, encryption keys, raw scopes, raw provider errors, or
provider payloads.

Known migration gap (2026-07): the shared Channel section still accepts the
legacy Center Agent `slackConnection.connected` boolean and uses it when the
canonical Message Channel projection has no Slack row. The Settings page fetches
both snapshots independently, so this fallback can present stale Slack state and
violates the single-status contract above. Do not extend this compatibility
input to another surface or provider; remove it once every Channel consumer
reads the canonical projection.

Lark and Feishu use an in-page Personal Agent wizard:

1. explain that this is a Channel connection, not access to Docs, Calendar,
   Mail, Tasks, or other business data;
2. start a Core-owned resumable registration attempt;
3. show the provider setup link and poll OpenMeld state;
4. show credential receipt and Webhook configuration as distinct progress;
5. report the actual permission and transport verification;
6. finish only when the canonical connection status is `connected`.

Closing or reloading the page never owns the provider poll loop. Core stores
the attempt, enforces the due time and lease, and continues due attempts from
its bounded minute tick. An open wizard may also ask Core to advance a due
attempt for faster feedback, but Web is not the continuation authority and
cannot create a second provider poll while another caller owns the lease. A
redirect, provider confirmation, or credential receipt alone is not success.

The Channels page also reads Core's separate, safe active-registration
projection. When setup exists before a formal connection row, the provider card
shows **Connecting** instead of **Not Connected**. It shows **Continue setup**
only when Core's viewer-specific capability says that the current member owns
that continuation; other managers and read-only members see honest progress and
guidance without an unusable action. The summary contains only the provider,
attempt id, lifecycle status, due/expiry times, bounded reason code, and this
capability. It never exposes the provider setup URL, device code, App
credentials, initiating profile, or another installer's private setup data.
Web polls this read model only while it contains an active attempt and refreshes
the formal connection projection after each progress read, including when the
active attempt disappears. A pending auxiliary read, including a refetch with a
cached empty result, keeps the canonical Channels list visible and shows a
neutral setup-status check only for an otherwise unconnected Lark-platform
provider. When an active attempt becomes terminal, Web keeps that neutral state
until the formal connection refresh settles instead of briefly offering a
duplicate setup action. If that formal refresh fails, Web retains the previous
setup progress and reports the read error instead of clearing progress or
offering any setup action. An unavailable auxiliary progress read remains
visible as an error, keeps an otherwise unconnected provider neutral, disables
setup actions until a successful refresh, and never hides the canonical
Channels list. The connection projection remains the only source of connected,
repair, revoked, and disconnected truth.

The provider setup page can fail without reporting that browser-side failure
to OpenMeld. While an attempt is still `pending_registration`, Web therefore
offers an explicit **Start over** action. It asks Core for a fresh provider
setup link and replaces only that pending attempt. Reopening the dialog without
that action resumes the existing attempt. Once credentials have been received
or configuration has started, Start over is unavailable and may not discard
the in-flight connection.

After credential receipt, Web no longer treats the provider's short-lived
device setup link as the App configuration deadline. Core gives the saved App a
seven-day configuration window. If that window expires, or the provider revokes
the connection, the card shows the bounded reason and an explicit **Repair
Lark** or **Repair Feishu** action. Repair retries the same saved App and
credentials; it does not create another provider App. The dialog must contain
that actual action whenever the card tells the user to select it. Channel-card
status badges use the same control height as their adjacent small buttons, and
dialog status badges use the same height as default dialog buttons. If an open
registration or repair becomes `repair_required`, the dialog returns to this
same Repair surface instead of telling the user to find a missing action.
Repair and Disconnect stay mutually exclusive while either mutation is in
flight. If another manager has already restored the connection, a stale Repair
request refreshes the canonical Channel list and reports that the connection is
already connected; it never tells the manager to disconnect a healthy App.
While Core is retrying configuration, the dialog shows the latest bounded
verification failure in plain language instead of presenting an unexplained
spinner for the rest of the configuration window.

The Lark card is available to every local and production Organization.
Availability means the user may start setup; the card becomes connected only
after Core verifies that connection's application configuration, Event
Subscription URL, and Message Card Request URL. Feishu stays unavailable while
its independent feature flag and provider gate are off. A failed Feishu
mainland reachability gate must produce honest unavailable copy rather than
silently selecting WebSocket or presenting a connected row. Development and
production apps and credentials never share a connection.

### Slack workspace connection

**Center Agent → Channels** presents Slack
as a two-way conversation surface in each Organization and as a discoverable,
read-only provider in a Personal Workspace. The Center Agent page
does not repeat Channel management or provide a personal-only inline variant.
Its header menu links directly to the canonical Channels page; it does not
render a separate `Connect Slack` or `Slack connected` shortcut.
In an Organization, `Connect Slack` presents `Add to Slack` as the primary path; after connection
the action becomes `Manage Slack`. The browser
uses the same-origin `/slack/oauth/start` route so its OpenMeld session reaches
Gateway through the existing allowlisted proxy; Slack then owns workspace
selection and approval. A successful callback and any failure with a verified
state return to the Workspace Channels page with a closed result code that
Web translates into one clear outcome and one next action. An invalid state, or
a state Core cannot verify, must not supply navigation authority; Gateway sends
those failures to the dedicated `/slack/oauth/result` page instead.

When Slack returns a workspace already connected elsewhere, Gateway asks Auth
whether the installer belongs to that previous organization. A member who is
still an owner/admin of the destination sees both organization names and an
explicit `Move workspace` confirmation explaining that Slack messages will stop
routing to the previous organization. Confirming starts a new Slack OAuth flow.
A non-member never receives the previous organization name and is told to ask
the administrator who originally connected that workspace for help.
After Core completes the move, the Slack installer receives the same fresh
trust-first treatment as a first connection because the destination
Organization has independent members, Spaces, Apps, and agent context. The
message is intentionally deferred until Center Agent member research has
produced both the provisional Profile Report and its real private Computer
file. **See what I learned** deep-links to that exact Organization Document.
**Invite teammates** and **Introduce me in channels** continue natively in
Slack; Web remains the complete People and Apps management surface rather than
owning a second onboarding state. An unchanged reauthorization does not repeat
the welcome.

The workspace-ID form remains under `Advanced: connect manually` for existing
installations and development recovery. Web does not collect a bot token,
create OAuth state, decide Binding ownership, or infer success from the Slack
redirect alone. Gateway and Core own those facts.

### Message Channel identity handoffs

`/link-slack?token=...` is the action-scoped handoff for a full member of a
connected Slack workspace whose requested Center Agent action needs verified
OpenMeld identity. An unauthenticated visitor goes to sign-in with the complete
return URL preserved; the auth footer preserves it through sign-up, and the
login route prefers Magic Link so a new user can satisfy the verified-email
gate with less friction.

After authentication, Web previews the exact Organization, Slack account,
Slack workspace, and OpenMeld account before one confirmation. The primary
action is **Join and continue** when Auth reports no current membership and
**Connect and continue** for an existing member. Success says that the original
request is continuing in the same Slack thread and offers **Open Slack thread**
when Core returns the exact source-message permalink. Web does not construct a
Slack URL from workspace, channel, or timestamp fields, and a missing permalink
does not turn a completed identity link into a failure. If identity linking
succeeds but the continuation reaches a known retryable failure, Web preserves
the completed linked state and offers one **Try continuing again** action. A
consume failure before linking keeps the confirmation action available for an
idempotent retry; Web never invents a successful continuation. An older private
token without source-delivery evidence reports that Slack was connected but
automatic continuation was unavailable. Missing, expired, or pre-private-
delivery token copy asks only for a new setup button in the original thread and
explicitly says the request need not be repeated.

When that Slack account is already mapped to another OpenMeld member, the same
preview explicitly says the confirmation will move the account. Only the exact
Slack-private token plus the intended signed-in OpenMeld account can replace
the mapping. Web never offers an administrator-only force assignment or uses
matching email as confirmation.

`/link-message-channel?token=...` is the provider-neutral counterpart currently
used by Lark and Feishu. It preserves the same authenticated-account preview,
one-account claim fence, existing-member **Connect and continue**, new-member
**Join and continue**, and retryable continuation behavior. Provider-specific
copy may say Slack, Lark, or Feishu, but Web must not fork the authority or
confirmation state machine. `/link-slack` remains a compatibility route until
Slack completes the provider-neutral storage and route migration.

The private Channel action uses **Connect my account and continue** when the
current request needs personal OpenMeld access, or **Connect my account** when
the user explicitly asked to connect it. It never says **Review possible
account match**, **Review identity**, or another internal phrase. The nearby
sentence names the concrete blocked action and says that connecting the account
will continue the same request.

The Web page uses **Connect your {Provider} account** and shows the exact
provider account, signed-in OpenMeld account, and Organization before the
primary **Connect accounts and continue** action. If Center Agent supplied one
likely current member, Core has already bound the one-time token to that user;
a different signed-in account receives a generic wrong-account response and
cannot see the intended member's full details. The page does not show scores,
matching evidence, other member identities, or ask the user to choose from a
directory. Auth may require fresh sign-in or step-up authentication. A stale
page cannot bypass that result, and the page contains no third-party content or
outbound link that could receive the bearer URL through referrer data.

Success says that the provider account is connected and that Center Agent is
continuing the original request. Expired, conflicted, membership-lost,
connection-changed, wrong-account, or already-linked states show one truthful
next action and never fall back to linking a different signed-in account.
If the provider account currently belongs to another member, preview says that
the action will move it and successful consumption reports that replacement;
the provider-private proof remains the authority.

### Center Agent App connections

**Center Agent → Apps** is separate from
Channels because Apps grant scoped tool access rather than a conversation
result surface. It is the single App catalog and management surface in every
workspace and shows both the current member's private access and
Organization-shared access. An App becomes connectable after its credential
UX, provider authentication behavior, required capabilities, scopes, and known
limitations, OpenConnector execution contract, and model-visible service
contract are verified against the provider's current official documentation and
the reviewed source. A live smoke remains post-enable validation rather than a
Catalog availability gate unless a separate provider decision explicitly
requires one. Shipped support does not render an `Available` badge. A supported
App with no active connection has no badge; a connectable App with an active
Core-returned connection shows
`Connected`; and an App that cannot yet be connected shows `Planned` regardless
of stale connection records. Connection lookup failures show one explicit retry
action instead of producing optimistic badges or silently resembling an
unconnected catalog.
The Apps page title and description are the Catalog's only visible introduction.
Category filters, the visible result count, and search share one page-level
control row rather than a nested Catalog header. Each App is an independent
shared `Card` that preserves its logo, name, category, status, and detail
navigation; the page does not wrap those cards in another Catalog card or repeat
an `App catalog` title and helper description.
On a cold read with no saved summary, the Catalog keeps each status slot stable,
shows a silent skeleton, dims and disables App navigation, and does not render
an unconnected state. A restored privacy-safe status summary may keep the last
connected badges and navigation visible while the current Catalog read runs in
the background. App details reuse a fresh Catalog snapshot when available; with
no usable connection snapshot, they render silent skeletons and no connection
actions until the read resolves. A stale snapshot on detail entry may keep the
last status visible, but Connect and Disconnect remain disabled until a current
successful read completes. The same fail-closed rule applies while a refresh is
fetching, paused, or failed. After the mounted detail has accepted a fresh or
current successful snapshot, the natural stale deadline alone does not create a
dead end; focus, reconnect, and live invalidation provide subsequent refresh
signals without a permanent polling loop. Management details use three stable
layers when applicable: `Your access`, `Member connections`, and `Organization
access`. GitHub uses the more concrete `Your GitHub` title for its first layer.
The Center Agent Chat page does not repeat App management or provide a
personal-only inline variant. Every surface explains which account an action
uses.

PostHog uses provider OAuth as its default connection path. Web opens the
authorization popup and waits for the same Core-returned active connection
truth used by other OAuth Apps; it does not infer success from the redirect.
`Use a personal API key instead` is an explicit fallback for self-hosted or
custom-URL PostHog instances. Choosing the fallback does not create a separate
connection kind in Core, and existing active PostHog connections remain valid.

Notion uses OpenMeld's public OAuth Connection for every new member or
Organization connection. The person authorizing the connection chooses the
Notion pages OpenMeld may access. `Use an internal connection token instead` is
an explicit advanced fallback for a Workspace Owner who manages a Notion
internal connection. Existing token-backed connections remain valid, and both
paths produce the same Core-owned App connection kind and status truth.

Figma uses OpenMeld's public OAuth App for every new member or Organization
connection. Web opens the same authorization popup and waits for Core-returned
active connection truth; it never renders a personal-access-token field or
infers success from Figma's redirect. The consented Figma identity may belong
to any Figma Organization or team that account can access. Organization access
therefore means an OpenMeld-managed shared delegated connection authorized by
the named member, not an Organization-wide Figma service account. Existing
PAT-backed connections remain valid until disconnected and do not create a
second Core connection kind. Because Figma excludes its Projects endpoints from
public OAuth Apps, Web does not promise project access for a new OAuth
connection. Its Figma description names only the supported file, component,
library, comment, and development-resource capabilities.

For `Your GitHub`, `Connect GitHub` opens the GitHub App user authorization in a
popup and keeps the OpenMeld page open. For `Organization access`, `Install
GitHub App` opens GitHub installation, lets the owner/admin choose all or
selected repositories, returns through OpenMeld's setup callback, and completes
the verifier authorization in the same popup. Web polls the authenticated
Gateway projection until Core reports the exact registered connection active.
It never treats the popup redirect itself as connection truth. Shared GitHub
setup explicitly requests Core's installation expiry from Gateway and keeps
waiting through that exact boundary; Web does not replace the ten-minute
server-owned window with a shorter fixed timer. The member GitHub authorization
flow remains bounded to two minutes. If a mixed-version response omits the
shared expiry, Web keeps the setup cancellable instead of inventing a deadline.

The card renders only Core-returned Organization connections. It explains that
OpenMeld can use only repositories included in an OpenMeld GitHub App
installation and allowed for the selected GitHub identity. It links to GitHub's
installed App settings. Organization work and Routines are described as running
as the OpenMeld bot; personal access is described as explicit-task access for
the current member's identity or personal repositories.

Disconnect controls come from Core's `canDisconnect` projection. Members manage
their own connection under Center Agent → Apps. Organization owners and admins
manage shared Organization access on the same page; regular members see shared
status read-only. Disconnect opens a modal confirmation before any mutation.
The modal explains that the operation removes this OpenMeld Organization's
connection but does not sign the user out of GitHub or uninstall the OpenMeld
GitHub App. Web never reads the provider
credential, trusts the executor's global connection list as ownership, or
renders the legacy `github:default` connection.

### Center Agent memory controls

**Center Agent → Memory** owns two explicitly separated scopes: the current
member's action to erase the Center Agent's memory of them, and ongoing shared
organization-memory policy management. **Settings → Personal → Privacy &
Safety** links to this canonical page instead of owning a second mutation
surface.

Setup Studio presents the Core-owned default as enabled without writing a
synthetic user choice. It does not become a second management surface. An owner
or admin may turn Organization memory on or off on the **Center Agent → Memory**
page; other members see the policy read-only. Web submits intent through
the shared HTTP contracts and then refetches Core-owned policy; a browser toggle
or cached value is never memory policy truth.

Copy must keep the two scopes explicit. Wiping member memory does not delete
messages, Spaces, or Organization memory. Organization memory is on by default,
and its control must explain that shared Space and connected Channel
conversations may be used while private Center Agent DMs are not automatically
written into Organization memory. Personal Workspaces keep the page because
Workspace memory remains useful across Spaces and connected Channels, and the
person still needs transparent controls to turn it off or erase their separate
member memory.

### Documents

**Documents** is a first-level current-Organization destination at
`/o/{orgSlug}/documents`. It behaves as an icon-based file browser: the current
folder's direct child folders and documents share one responsive card grid and
one direct opaque card-surface interaction. Dragging uses a separate opaque
preview so the page never shows through the moving item. Folders look and act
like folders; documents look and act like files. Opening a folder keeps the same
route and sets the `folder` search param. The breadcrumb resolves every ancestor from
`Documents` to the current folder, so users can enter, return, and browse any
depth without a secondary sidebar or a permanently expanded tree. Documents
within each folder remain ordered Organization Brief first, Profile Reports
with their associated member, then ordinary knowledge documents. Pending
Center Agent content for the Organization Brief and knowledge documents is
visible as an amber Draft badge, and the detail surface opens on the read-only
proposed draft in the same editor. The approved document stays available behind
an explicit view toggle and must remain unchanged until approval; draft text
becomes approved content only through approval. A Profile Report is the
deliberate exception in presentation: the browser does not add a Draft warning,
and its detail page shows the latest provisional result under **What I've
learned so far** without approve or discard controls. When that visible version
still needs to be saved, the explanation says so directly and the existing
**Save changes** action is available without requiring a text edit.

The Documents root includes one compact, non-technical sharing explanation:
approved Documents are available on the Center Agent Computer, and its proposed
changes return to this same surface as reviewable drafts. The message describes
the user benefit and approval safety without exposing projection paths,
revisions, sidecars, or synchronization internals. It is informational, not a
second Computer status or configuration surface.

Owners and admins can create all document kinds, edit approved content, delete,
approve or discard drafts, and manage folders: create nested folders, rename,
move, and delete them, and move documents through drag and drop onto a folder
card or breadcrumb destination, or through an item's Move to menu. Deleting a
folder moves its direct documents and direct child folders to its parent. A
member can open and edit the approved body of their own Profile Report and sees
the same folders without management actions. Creation requires a kind; Profile
Report creation also requires a current Organization member, and creating from
inside a folder places the new document or folder in that folder.

The detail surface edits approved content in a rich Plate editor whose
persisted contract stays plain CommonMark + GFM; every editing affordance it
exposes must round-trip through Markdown, and non-Markdown upstream features
stay out. A pending Center Agent draft renders read-only in that same Plate
surface, so what the reviewer reads is exactly what approval publishes; an
amber review bar owns the draft/approved view toggle and the approve and
discard actions for Organization Brief and knowledge drafts. A provisional
Profile Report opens directly in the same editable Plate editor for the person
it describes. Saving turns that visible starting point into the member's
current content and resolves its Inbox attention without an approval-specific
button, correction flow, or discard chore. The calm explanation names review
and save as the one next action only while a provisional version is pending.
Documents introduces no upload surface.

People links to a Profile Report only when one already exists. It never opens a
prefilled blank document as a substitute for learning about the member.
**Center Agent → Center Agent settings** links to the existing Organization
Brief, or to a prefilled Brief creation route, and does not duplicate the
editor in Settings. Organization switching preserves the Documents route
family while replacing all document data with the target Organization's scope.

People is a two-pane workspace. Its secondary sidebar lists one Human Profile
per current member and the main content renders the selected person's complete
Profile detail. A sidebar item may show only the high-frequency scan signals:
the Human Profile avatar, name, explicit `(you)` marker, Organization role,
Core-owned relative last-seen time, coarse Computer state, actually linked Slack,
Lark, or Feishu identity icons, and each enabled reported Local Agent icon. It
does not show email, provider account text, disabled Local Agents, unavailable
identity mappings, or placeholder icons for providers the person has not linked.
If no mapped Channel identity exists, Web renders no identity row. The relative
time uses compact body copy such as **3 hours ago** and a tooltip such as **Last
seen 3 hours ago**. It shares one row with Local Agent icons, with the time on
the left and icons on the right. All logo-only signals have accessible names and
tooltips. Local Agent identity
uses the same catalog-owned logo and name as Computer detail; Web never creates
a second name or logo map for People.

Last-seen time comes only from the Core-owned, Organization-scoped Human activity
projection. Web explicitly reports entry, return to the foreground, and a
bounded visible-session heartbeat; Core re-verifies the active member and that
member's current active Human Profile before advancing the projection. CLI use,
Auth session refreshes, Computer heartbeats, and Agent Activity are not
substitutes. Undefined activity is omitted instead of rendering a placeholder,
and relative last-seen text never claims live online presence.

The sidebar groups members with one or more registered Computers under
**Connected** and members without a Computer under **Not Connected**. Hovering
or focusing those labels explains **Computer connected** and **Computer not
connected**. The signed-in member's group appears first and the signed-in member
remains first inside it. Everyone else sorts within their group by descending
last-seen time; missing activity sorts last, then name and user ID provide stable
tie breakers.

Selecting a Human Profile sidebar item replaces the main content without
opening a right drawer. The route preserves the selected `profileId`, so reload,
back, and forward navigation return to the same person. The persistent detail
owns member account details, Organization role, join time, an ordinary Agent
Profile count with up to three controller icons and an overflow count,
Computers, Connected Channels, shared Profile details, and the permitted
Profile Report, Learn about, Direct Message, inline edit, connect, or manage
actions. The Agent Profile count links to Agents and focuses the first Agent
Profile in that member's owner group. Member-account, Channel-account, Profile,
and advanced-detail values are text-selectable. Editing remains available only
for the signed-in member's own active default Human Profile. The sidebar and
detail omit the internal Handle, undefined recent activity, and the ubiquitous
**Active** state; only an exceptional disabled state is visible. Web does not
derive an Organization online dot from last-used time, Computer state, or
Space-scoped presence. Members without an active Human Profile have no Direct
Message or edit action, but their detail remains available for inspecting
account details and the explicit unavailable or disabled profile state. The
signed-in member cannot Direct Message themself.
People admits only one pending Direct Message
open intent at a time so competing responses cannot navigate to an earlier
selection. The People sidebar includes
**Learn about all members** and shows processed progress such as `3/8` while
Core runs the serial batch. A member currently queued or running shows
**Learning…**; other starts stay disabled until the batch is terminal.
People polls the Core-owned status and document list while work is active.
When a Profile Report exists, the document icon opens the latest report; amber
indicates that it has updates to review and save. **Learn about {member}**
remains available beside it so a member can create a fresh dated report. A
successful Documents read that contains no report shows only **Learn about
{member}**. Loading or failed evidence shows neither action because Web cannot
yet prove whether a report exists. The selected detail follows the same
evidence rule and keeps the learning action beside Direct Message when both are
available.
**Profile Report** is the user-facing document term; the persisted
`member_profile` kind and member-research orchestration names remain
compatibility contracts.

In an Organization workspace, People reads the Organization Computer
projection and shows a concrete summary on every Human Profile sidebar item. Exactly
one online Computer is **Computer connected**. Two or more online Computers are
**2 computers connected**, **3 computers connected**, and so on. A mixed set
summarizes only the online count, while an all-offline set is **Computer
offline** without a number. Zero registered Computers remains **Connect a
computer** for the signed-in member and **No computer connected** for a
teammate. Attention and unavailable states remain explicit.
The sidebar Computer icon uses the same state without a separate dot: green
for connected, amber for attention, and muted otherwise. One Computer opens its
detail from its card in the selected Profile; multiple Computers remain separate
cards in that same Profile. The signed-in member with none receives **Add a
Computer** and the normal setup route; teammates have no setup or management
action. A failed or incomplete response never blanks People or changes a
member's identity; missing evidence stays unavailable rather than being
presented as not connected. Computer state never claims that the Human Profile
is online. The main detail uses the same summary tone and projection as the
sidebar.

The selected Human Profile detail replaces the former **Work access** row with
the existing Computer cards, preserving Computer name, operating-system and
device metadata, state, Local Agent summary, last-seen evidence, and direct
navigation to the existing Computer detail. This is component reuse, not a
second Computer card implementation. **Add a Computer** appears alongside the
cards only for the signed-in member.

People reads Message Channel connections and their Core-owned identity-link
projection together. The sidebar shows a provider icon only when the selected
member has a real identity mapping for that provider. Missing, unavailable,
unconfigured, and unmapped accounts add no sidebar placeholder. **Set up**,
**Connection unavailable**, **No account connected**, provider account text,
and self-only actions belong in the persistent detail. **Connect Slack**,
**Connect Lark**, or **Connect Feishu** opens the existing private
provider-proof flow; selecting a Human Profile never assigns a Channel account.
When the Organization has not configured that provider, the same connection
panel gives an owner or admin **Set up Slack**, **Set up Lark**, or **Set up
Feishu** and gives an ordinary member **Ask an admin to set up {provider}**.
The member action creates one deduplicated Organization Inbox request for every
current owner and admin instead of granting Organization mutation authority.
That request links directly to **Center Agent → Channels** and resolves when the
Organization connects the provider.
The detail exposes the same self-only connection action and keeps a mapped
identity visible as unavailable
when that provider connection needs repair. All status copy remains neutral
gray rather than amber. When available, the detail shows the provider account
name or handle first and the exact provider email
second, separated by a middle dot. Either field may be absent, and Web never
infers one from the other or adds `@` to a provider display name. For Slack, Core
resolves the display metadata for the exact linked Slack user through the
connected Organization workspace; if neither field is available, Web says
**Account details unavailable**. The current member can use **Reconnect Slack** to refresh a
legacy identity proof without disconnecting first. An admin cannot perform that
provider identity proof on another member's behalf.
Self and Channel managers may disconnect a wrong mapping; replacement still
requires a private provider proof and confirmation by the intended signed-in
account. Disconnecting this relationship never disconnects the Organization
Channel.

The top of the People sidebar owns one **Invite Members** button, parallel to
**New Space** in Spaces. It opens a single dialog containing both invitation
methods: email plus role plus **Send invitation**, and the Organization invite
link with **Copy**, **Reset**, and **Revoke**. These lower-frequency controls do
not consume permanent main-content space. Personal workspaces keep the button's
position but show the existing Organization guidance instead of pretending an
invitation is available.

### Projects

**Projects** is the first-level home for the current Organization's code
Projects. Its canonical routes are `/o/{orgSlug}/projects` and
`/o/{orgSlug}/projects/{projectId}`. Switching Organizations preserves the
Projects route family while replacing Project data and all current-computer UI
state with the target Organization's scope.

The page owns Project cards, creation, editing, removal, Project detail, and
owner-self folder discovery and connection presentation. Web reads canonical
Project identity and permissions from Core. It sends current-device discovery
and connection intent through the authenticated Project operation contract and
never reads the local filesystem, treats a browser path as authority, or stores
an absolute path in cloud state.

Project discovery is an explicit, bounded **Checking this computer** state.
Projects home, Project detail, and Agent Profile Project controls share one
Organization-wide current-device query for all active Projects. Fresh results
are reused for 30 seconds across navigation; **Check again** always starts a
new query. During a background recheck Web keeps the last result visible, and a
failed recheck says that the last result is still shown. A manual path
submission or confirmed connection cancels eligibility for the current browser
query before Web rechecks. Connection conflicts name the conflicting Project
slug and distinguish **this Organization** from **another Organization**.
Instead of requiring the user to disconnect elsewhere first, Web explains
whether moving the folder leaves the old Project without a connection, changes
its default, or leaves its default unchanged. Only **Move folder** retries with
the Service-issued confirmation token; **Keep current connection** makes no
mutation. If the current Core projection omits `moveConnection`, Web treats it
as unsupported. If an older Service returns only the legacy conflict, Web uses
Organization/Project language and asks the user to update OpenMeld Service
before retrying.

Matching repository and worktree candidates use one controlled picker that
supports Fluid radio controls for single selection and Fluid checkbox controls
for multiple selection. Project detail uses multiple selection and connects
the chosen folders sequentially before one discovery refresh; it never races
parallel local connection writes.

The primary creation form asks for Project name and optional Repository URL.
Web holds the raw URL only long enough to compute the shared fingerprint and
then discards it. Slug is generated by the shared algorithm, shown under
Advanced as **CLI slug**, and remains editable without becoming route identity.
Cards with duplicate names show their slugs for disambiguation.

The complete Project domain, privacy, permission, local connection, and Wake
contracts belong to `developing/product/projects.md`.

Final hosted Center Agent replies may carry one optional, Core-built
`navigationAction` in their canonical message envelope. The main conversation
and thread surfaces project that field through the shared timeline and render
it after the answer. Rendering is gated by the trusted final-agent-reply marker;
human messages and ordinary assistant Markdown links never receive the
action-button treatment. Because the action is persisted with the signal, it
remains available after refresh and live-tail reconciliation. The shared target
variants cover GitHub App access, one Space, Projects home, one Project, and
computer setup, reconnect, or required OpenMeld Service update.

Ordinary Spaces present a computer action as the same-tab authoritative Connect
link. Slack receives the structured native button and fallback link; Lark,
Feishu, and generic Message Channels receive the exact trusted action URL as an
ordinary link until they gain a structured action renderer. Only a trusted
first-party Center Agent Direct Message with current Organization, member, and
Space context replaces the newest trusted computer action in the main timeline
or one thread with the shared inline Connect flow. Older computer actions remain
authoritative links so conversation history cannot mount parallel Prepare
Sessions. Revisiting an action that already started shows an explicit
**Continue setup** or **Continue update** gate before Web may create another
Prepare Session or Terminal command. The direct **Connect my computer** starter
opens the same flow without sending a hidden message. After authoritative
completion, **Continue with Center Agent** sends one visible preset member
message through the ordinary main or thread composer path. Once that message is
present in the same timeline, the action stays completed and cannot be sent
again after refresh. A required OpenMeld Service update must also pass version
verification before that action appears. Setup completion never impersonates
the member or silently wakes the Center Agent. A GitHub
connection-unavailable tool failure still records the GitHub App target before
the final reply, so localhost and production Web use the same structured button
instead of depending on Markdown URL rendering.

### Agent Activity

**Agent Activity** is the first-level entry for the shared Agent Activity
product in every workspace. Project and snapshot queries are keyed by
Organization id; switching Organizations remounts local filter state
so another Organization's Project cannot remain selected.

- **Monitor** — **Overview**, **Sessions**, and **Changes**

The layout owns and shares four Organization-id-keyed queries: the current
snapshot, active Projects, Organization directory, and aggregate stats. The
snapshot retains its 15-second refresh cadence. Aggregate stats use the
separate STATS1 read contract and a five-minute stale time; a slow or failed
aggregate read renders a skeleton or dash only in its card and never blocks the
snapshot-backed dashboard. Switching Organizations remounts the complete
layout by Organization id so time-window, filter, and Project-filter state
cannot leak into another Organization.

One **Project scope** selector sits at the far right of the shared header and
owns the largest Monitor scope. Its `project` value is nuqs-backed URL search
state, so **Overview**, **Sessions**, and **Changes** keep the same selection
when the user moves between pages or shares a URL. `All Projects` omits the URL
value. A selected Project scopes both the snapshot and STATS1 reads before the
browser derives cards, lanes, tables, or changes; the interface must never mix
Project-filtered rows with Organization-wide aggregate cards. An invalid or
stale Project id is cleared after the active Project list resolves.

**Overview** uses one dashboard scan path in three sections:

1. four compact cards for **Working now**, **Agent time today**, **Total agent
   time**, and **Sessions today**
2. one large **Activity timeline** card with **1h**, **4h**, and **Today** windows
3. a compact table of the ten most recently observed sessions

Card footers contain at most one short fact. Metric definitions live in title
tooltips instead of explanatory footer prose. Snapshot-derived numbers use a
`~` prefix when `sessionsTruncated` is true. **Agent time today** sums the span
of every session intersecting the member's local day; parallel sessions are
additive. **Total agent time** comes only from STATS1's
`totalActiveDurationMs`, with `sinceMs` shown as its start boundary.

Activity timeline groups sessions by member and then by `provider:projectId`. Its window
is a derivation parameter, not component-local clipping. Historical segments
always use the neutral muted tone. Only a currently active segment uses the
ready tone and glow; amber is reserved for the row-end Idle status. Clicking a
lane opens **Sessions** with the member URL filter. Activity timeline has no inline
accordion or second session-detail surface. Whole-hour ticks that would sit
within four percent of the Now tick are omitted. Its empty state keeps the
copyable Project bind guidance.

**Sessions** owns the complete current Local Agent Session Inventory. It uses
the separate shared paginated Core query rather than the bounded Activity
snapshot. Provider, Working/Idle/Ended/Error/Unknown, Owner, origin, and search
controls are URL state and are sent to Core. Project remains absent from its
toolbar because the shared header is its single source of Project scope. Next
page navigation uses the opaque Core cursor; a later page can return directly
to the first page, and every filter change resets the cursor.

Each row renders the provider-native title, copyable native Session id, Owner,
Project, public Computer name, Local Agent, status, last activity, origin,
Resume/Fork capability, and authoritative bound Agent Profile. It never renders
an internal device id, Service runtime id, local connection hash, local path,
prompt preview, branch, model, transcript-derived summary, or arbitrary
provider metadata. Missing native title is **No native title**; Web does not
invent a provider-name title.

Session and Computer state badges use the shared semantic status-tone surfaces
in both light and dark appearances. Muted states such as **Offline**, **Ended**,
and **Unknown** remain quiet neutral labels rather than inheriting a solid
primary Badge background; Working, Idle, and Error keep their ready, warning,
and danger meanings.

Coverage facts own honest empty and degraded states: waiting for first sync,
syncing, current empty, stale data, disconnected Project, offline Computer,
unsupported provider, and reconciliation error are distinct. Web does not turn
a failed or unsupported source into “No sessions.”

Bound Sessions open the authoritative Agent Profile. Eligible unbound Sessions
offer Create Agent Profile. Resume as Agent Profile and Fork as Agent Profile
are shown only from the returned capabilities and delegate all mutation and
authorization to Agent Profile creation. Add to Space delegates to canonical
Space membership. A Working Resume may show one lightweight suggestion to Fork
when available, but Web neither blocks it nor builds a recommendation score.

**Changes** owns the full current state-transition list. Heartbeats and generic
session updates remain folded, with the heartbeat count disclosed below the
list. A `session_started` followed within 60 seconds by `session_active` for the
same member, provider, and Project becomes one **started working** entry.
Changes is not capped below the snapshot's existing 100-event boundary.

`clients/web/src/components/organizations/agent-activity-derive.ts` remains the
single browser derivation entry for Overview and Changes. It owns current-active
evaluation, local-day span totals, peak concurrency, busiest Project, longest
visible run, facets, timeline clipping, and Changes folding. An expired
`isActive` claim is never displayed as current. Durations below one minute use
`just now`, never `0m`. The Organization directory supplies member names and
avatars when available; missing directory evidence falls back to the public
session member name and initials without blocking Activity.

The page explains explicit opt-in collection and its reviewed disclosure
boundary in the header. It retains Project filtering and a **Manage Projects**
link to the canonical Projects home, but it does not create, edit, remove, or
connect Projects. The snapshot's `asOfMs` and staleness threshold own the stale
warning. Session and
digest truncation remain explicit. A newer failed digest keeps the previous
completed summary visible and says the new summary failed; Web never generates
a fallback summary. Provider or status filtering hides Project digests rather
than presenting an unfiltered summary beside filtered activity.

Legacy snapshot rendering receives provider-supplied session titles and explicitly opts
in to the optional, strict provider-specific source metadata projection. It
renders every reviewed field that Core returns. A missing title is displayed as
`{Provider} session`; Web never introduces an `Untitled session` state. Readers
that omit the request flag retain the frozen legacy response shape. Web never
receives or renders provider session ids, device ids, local paths, or runtime
identity. Snapshot failure leaves the Projects link available and shows an
explicit refresh failure rather than treating missing activity as an empty
current state.

### Routines

**Center Agent → Routines** is present in every workspace. Every organization
member may read Routines and create a Routine that schedules the Center Agent to
work once or recurringly in one explicit destination. A member manages Routines with their own
`createdByUserId`; an owner or admin manages all Routines in the Organization.
Web presents the schedule, optional timezone, destination, next run, last-run
summary, enabled, paused, or completed state, and paginated Run history, but it does not own or infer any of
those facts.

Web reads Routine, Run, permission, and available-target projections through
the shared HTTP client. The available-target projection is Core-owned and must
already account for organization scope and the Center Agent's ability to publish;
Web must not reconstruct that decision from the ordinary Space directory,
membership calls, or browser state. Opening create or edit ensures the lazy
member-to-Center-Agent Direct Message Space exists through the existing Center
Agent DM operation, then refetches the target projection. A failed or mismatched
projection remains visible and actionable and must not produce a guessed target.
If a stored target no longer appears in the latest eligible projection, Web
shows it only as the unavailable current target. The user must choose an
eligible replacement before saving; Web must not silently retain, replace, or
submit the unavailable target.

The shared HTTP client explicitly requests `contract=management-v2` for the
Routine management list and `contract=practical-v2` for mutations and Run
history. Each row presents the Core-owned creation snapshot as “Created by
you,” the frozen member display name, or an explicit organization-member
fallback for legacy unknown data, followed by the Local Agent client when one
was verified at creation. Web does not join current profile or audit state to
reconstruct it. Requests without an opt-in belong to the frozen
published-client projection and cannot represent one-time or Slack-thread
Routines. Web must not infer practical, capability, or creation-attribution
fields from an older shape or remove an opt-in to make a mixed-version response
appear successful.

`canManage` is the sole browser projection for update, pause, resume, and delete
controls. When it is false, those controls are absent rather than merely disabled.
Creating remains available to organization members, and read-only members may
still open Run history. Web submits explicit user intent through the shared
Routine API, invalidates its query cache after success, and rereads owner truth
instead of presenting an optimistic mutation as final.

Web create and edit support one-time and recurring Space Routines. Slack-thread
Routines created from Slack remain readable with Run history, pause/resume when
applicable, and delete authority, but Web hides edit until it has a durable
Slack destination picker. It must never convert a Slack Routine to a Space by
submitting form defaults.

Run history displays only the shared Run status and publication fields. Failed
Runs may show their failure code and detail, skipped Runs use neutral treatment,
and claimed or submitted runs stay visibly in progress. Web must not infer a
terminal outcome from internal delivery, ledger, or database fields. Deleting a
Routine stops future scheduling but does not imply that existing run history was
deleted.

Web parses Run and `lastRun` `scheduledFor` through the shared signed
safe-integer contract. A negative value is renderable only for a `skipped` Run
with `failureCode = routine.schedule_invalid`; other negative combinations fail
as invalid owner responses. Web must not clamp or hide valid pre-1970
quarantine evidence. Other Routine timestamps remain nonnegative.

Routine and target query caches are organization-scoped interaction aids, not
authority. Opening create or edit refreshes eligible targets from owner truth;
the target picker must not offer cached entries while that refresh is pending.
Successful mutations invalidate and reread the canonical Routine and Run
projections instead of treating an optimistic browser value as final.

When the Organization has an active App or connected Slack Message Channel,
the Routines page recommends **Center Agent Self-Evolution** unless the
marker-bound built-in Routine already exists. A marker match alone does not
mean the Routine is configured: Web also requires the Core-owned management
projection to match the approved-knowledge, read-only, and optional Slack
report capabilities expressed by the instructions. A mismatch is shown as
**Needs repair** with guidance from the Core-owned repair-authority projection.
Web offers the explicit repair choice only when that projection permits it and
does not silently restore permissions during an unrelated edit. The card lists
the qualifying
sources and lets an owner or admin configure source scope, optional target
Project, daily/weekly/custom cadence, timezone, target Space, and an editable
learning focus. The target Space is labeled **Learning archive** because it
receives the complete result. When Slack is one of the connected sources, setup
also offers a separate optional **Team report**: the approver enters one Slack
channel name and the Routine may publish only a concise summary there. The two
outputs are independent choices, not a destination replacement or a hidden
Slack-thread Routine. Personal workspaces do not show this Organization feature.
Other Organization members see why an owner or admin must enable the Routine.

The recommendation disappears when no qualifying source exists; Local Service
presence is not a recommendation signal. Source check failures remain visible
instead of being presented as an empty source list. The setup states that
source selection guides the instruction rather than changing connection
authority, and that Slack reads remain bounded by the connected Channel's
authorized channel, member, and history tools. Web submits
the existing approved-knowledge authorized action and, only when the Team
report is enabled, the bounded Slack-report action through the shared Routine
client. Create sends that explicit choice. Edit sends capability fields only
when the user changes whether the Team report is enabled or confirms an
authorized permission repair; changing only its Slack channel name is an
ordinary instruction edit and preserves the canonical stored capability value.
The shared client
must preserve `authorizedActions` when supplied; silently dropping that field
would create a Routine that cannot fulfill its visible document-maintenance or
team-report promise.

### Home first paint

The deferred proposal for replacing the current aggregate Space bootstrap with
a bounded, versioned entry read model is tracked in
`developing/clients/open-space-conversation-plan.md`. That plan is not current
production behavior and does not authorize implementation before its trigger
and consumer-inventory gates are satisfied.

The Organization index renders the canonical Center Agent conversation as Home
at `/o/{orgSlug}` after its route guard confirms current Organization access.
Ordinary Organization selection, creation, invitation acceptance, and
onboarding completion all use this same default path. An explicit intent, such
as continuing Slack installation, may still enter its named destination
directly.

The Center Agent pathless layout branch owns both Home Chat and its explicit
capability routes with outer app rail + full-width content and no secondary
sidebar. That branch owns its pending component; the global router does not
infer Center Agent pending UI from a pathname. The outer rail derives its
selected destination from route matches instead of page props or
navigation-intent state.

Agents, Spaces, ordinary Space conversations, and the Center Agent conversation
each own a route pending shell behind the shared 300 ms optimistic-navigation
delay. Navigation that resolves inside that window never mounts the pending
shell; a genuinely cold or slow transition then replaces the previous page with
the target route geometry and structural skeleton. Pending shells have no
minimum display duration, so completed work is never held behind an artificial
loading interval. The shell is display-only and must not expose an
Organization-scoped mutation before the parent Organization access route
resolves. Once a conversation has renderable Query data, a background
`isFetching` transition must keep that conversation visible rather than return
to the route or conversation skeleton.

Intent preload warms the same TanStack Query keys consumed by the target page:
account Profiles plus the Organization Directory for Agent Profiles, account Profiles
plus the Organization Space Directory for Spaces, and the current Space display
snapshot, history, status, and bootstrap for a confirmed human profile. Conversation
preload restores the bounded Dexie display snapshot and recent history before
prefetching the current server reads, so a saved conversation can render immediately
without racing browser hydration. Status and bootstrap prefetch remain parallel with
that restore-and-history chain. Links from
the Space Directory carry
the already selected human profile so the Space bootstrap can start during
intent preload instead of waiting for a second profile-resolution navigation.
The button-based Space and Direct Message sidebar rows preload their exact target
route and conversation data together: a 50 ms pointer dwell avoids warming rows
that the member only passes over, while keyboard focus and pointer press start
immediately. The mounted authorized App shell supplies its already resolved
Organization, storage scope, and acting Human Profile to the conversation-data
prefetch, so Dexie restoration and the current history request do not wait for the
Router preload to resolve those same prerequisites again. The Router preload still
runs in parallel, and every server read keeps the normal authenticated and
authorized API boundary. Leaving before the dwell cancels the pending preload, and
the current active conversation does not preload itself. The target remains bound
to its Organization, Space, and acting Human Profile, so Query deduplication,
browser history restoration, current history, status, and bootstrap all reuse the
normal entry path instead of creating a second cache or source of state.
TanStack Query is the sole freshness owner for loader-prefetched data. The
Router's preload freshness window is zero, so every loader invocation reaches
the exact Query key and lets that query's `staleTime`, in-flight deduplication,
and invalidation state decide whether a server read is needed. The Router must
not add a second freshness clock over Query-backed loaders.

The Center Agent conversation is the deliberate exception to route-loader
intent preload. Opening or ensuring its DM is activation-only, and a read-only
preload must not return a different loader result that navigation could render.
The route disables loader preload and resolves canonical route data only on
entry. The primary app rail and global launcher may nevertheless prefetch the
read-only Center Agent DM projection on pointer intent or keyboard focus. When
that projection identifies an existing DM, Web restores and warms the exact
Space display snapshot, history, status, and bootstrap Query keys consumed by
the activated conversation. A missing projection ends prefetch immediately: hover and focus
must never call the open endpoint, create a DM, or perform another mutation.
The stable, read-only DM projection may persist in the approved Organization
browser-read segment. The full route and compact launcher render that cached
identity immediately and revalidate the projection in the background. Restored
Space content is display-only until current Space status confirms access;
mutations, membership panels, and other authority-bearing controls remain
unavailable. A genuinely cold entry shows its pending shell only after the
shared optimistic-navigation delay.

Non-persisted bounded display data used by these frequently revisited routes
remains in the in-memory Query cache for 30 minutes after its last observer.
This includes the bounded Space bootstrap, status, recent history, and members.
The explicitly persisted display queries use the longer lifetime defined
below. Query-specific `staleTime`, live invalidation, and server reads still own
freshness; the Organization scope query is not given either longer lifetime.
Cached display data is therefore a first-paint aid, never membership,
permission, or mutation authority.

Authenticated route loaders may warm these same Query keys during SSR and let
the existing TanStack Router SSR Query integration hydrate them on direct entry.
Private, membership-scoped, real-time conversations must not be statically
prerendered or placed in a shared server cache; intent prefetch, request-scoped
SSR data, the account-scoped browser cache, and live invalidation are the
allowed acceleration layers.

### Browser read-cache persistence

OpenMeld Web may retain a narrowly approved subset of bounded display queries
in IndexedDB so a confirmed returning account can see useful route content
while current server reads are still running. TanStack Query remains the only
client read-cache API. Dexie is the IndexedDB storage engine underneath the
official TanStack Query persistence protocol; routes and components must not
read Dexie directly or create a second browser data model.

The persistence allowlist contains exactly six successful query families:

- `startQueryKeys.profilesForStorageScope(accountId)` for the confirmed account;
- `organizationQueryKeys.spaces(organizationId)` for one confirmed account and
  Organization pair;
- `organizationAppConnectionQueryKeys.statusSummary(organizationId)` for a
  privacy-safe App catalog hint containing only the Organization id and the
  service ids that had an active Core-returned connection;
- `centerAgentQueryKeys.directMessageSpaceProjection(organizationId)` for the
  safe canonical Center Agent DM identity returned by the read-only projection;
- `spaceQueryKeys.history(spaceId, openMeldProfileId)` for one confirmed
  account, Organization, Space, and acting Human Profile. This is the same
  recent main-timeline snapshot consumed by the conversation and is capped at
  30 validated recorded signal envelopes; and
- `spaceQueryKeys.displaySnapshot(spaceId, openMeldProfileId)` for a versioned,
  validated Space identity and presentation snapshot with current actions and
  latest-message preview removed.

No prefix, default-on, or exclusion-based persistence rule is allowed. Adding a
query requires an explicit allowlist change, privacy and authority review, and a
test that proves unrelated queries remain absent. Organization scope,
activation, directories, Center Agent designation and open-command state, Space
bootstrap and current status, Thread lists and Thread signals, membership
authority, readiness, current-device facts, Wake state, diagnostics, errors,
and every mutation remain excluded. The
full App catalog response and per-service connection responses remain excluded;
member names, user ids, provider connection names, and connection records must
never enter the persisted App summary. That summary may avoid a false
unconnected Catalog first paint and enable navigation while the current read is
running, but it never enables a connection mutation or decides detail-page
access. The
Space Directory's `joined` field may be retained only as a stale grouping hint;
it never enables an action, and `lastJoinedAt` is redacted before persistence.

Persistence activation begins only after the Organization access route has
confirmed the signed-in storage scope and current Organization. Account and
Organization activation is one atomic controller operation so concurrent route
loaders cannot activate a new Organization before an old account is cleared.
Browser restore
has a 100 ms waiting budget and may never delay the normal route fetch or target
pending shell beyond that budget. That budget starts when the target navigation
requests activation and includes any older scope work already queued; rapid
Organization switching must not stack multiple restore budgets. Restored data
is invalidated immediately so
the existing query-specific `staleTime`, server read, and live invalidation
continue to own freshness. A seven-day `maxAge` and matching `gcTime` bound how
long the saved display snapshot may help first paint; they do not make it
authoritative or fresh for seven days.

Current Space status is intentionally not persisted. After a successful status
read in the current signed-in account, Organization, Space, and acting-Profile
scope, Web derives the smaller display snapshot by removing current actions and
the latest-message preview before persistence. On a return visit, that display
snapshot and the bounded history may render immediately while current access is
checked. The composer remains available for browser-local text authoring with
**Write a message while OpenMeld checks access…**, but Send, file actions, and
every other mutation or authority-bearing secondary surface stay unavailable
until the current status succeeds. Pressing Enter during confirmation must not
bypass that mutation boundary. Background `isFetching` and a transient refresh
failure do not erase an already visible conversation. An explicit access
rejection immediately hides the private content and clears only that
account-plus-Organization-plus-Space-plus-acting-Profile segment. Session
expiry, account replacement, or Organization-scope change still wins
immediately and clears its broader owning segment.

On a cold open with no safe display snapshot yet, the loading shell mounts the
same browser-local text draft immediately instead of a Composer skeleton. That
draft and its focus carry into the confirmed conversation without remount loss;
it still cannot send or attach files before current status authorizes the
mutation.

Persisted records are segmented by confirmed account and by account plus the
immutable Organization id. Organization slug is a secondary cleanup index for a
direct access-denied route; it is never the primary identity. Sign-out and
account replacement clear the previously active account's persisted data before
in-memory account queries are removed. If a cold auth boundary cannot know the
previous owner, it clears this narrowly scoped browser read-cache database.
If that unknown-owner cleanup fails, persistence remains locked and retries the
cleanup before any later account or Organization segment may activate.
Organization rename, deletion, and a confirmed access-denied recovery clear the
affected Organization segment and every saved Space view under it. Space views
use separate account-plus-Organization-plus-Space-plus-acting-Profile records,
so changing Spaces or acting Profiles never mixes message history and cleanup
does not rewrite a sibling conversation. An
account switch observed outside the normal
auth boundary must fail closed by removing the previously active persisted
display queries from memory and disk before a new account segment activates. A
timed-out restore hydrates an isolated cache first and may merge into the app
cache only while its original segment is still current; it rechecks that fact
before subscribing, so a late old-account restore is discarded.

When a saved Space list is visible and background refresh fails, Web keeps that
list visible, labels it as the last saved browser view, and offers Retry. Actions
that would change server state, such as joining a Space, remain disabled until a
current successful read completes. A paused offline refresh does not count as a
current read. Open navigation may remain available because the destination's
server read still decides access. With no usable saved data, the ordinary
skeleton and error behavior remains unchanged.

IndexedDB unavailable, corrupt, over quota, expired, or blocked is an
observable acceleration failure, not an app failure. The network path continues,
corrupt records are discarded and may be repaired by a later successful read,
and schema version changes close older tab connections. The query-cache writer
subscribes only to successful data updates for the exact query owned by each
segment; unrelated query events and all mutation-cache events must not serialize
or write these records. After saved Space history is restored, the existing
live-tail reconciliation reads updates after its latest recorded signal id. A
missing or reaped anchor falls back to the bounded recent-history read. On a
cold restore with no successful in-memory status snapshot, the safe display
snapshot and history may render read-only while current Space status confirms
access; no mutation can become available before that confirmation. Status and
the full bootstrap may start in parallel so confirmation does not wait for the
larger response. Persisted
mutations, offline send replay, unbounded Thread history, and active AI stream
resumption require separate product contracts for intent, idempotency,
conflicts, deletion, privacy, server continuation, and user-visible pending
state; Dexie availability alone does not authorize them.

### Browser Composer draft persistence

Unsent Composer drafts are a separate browser-local authoring concern, not a
TanStack Query read cache and not a durable Space or Task message. Web stores
their small serializable state in `localStorage` so a refresh, route remount, or
compact-to-full presentation change does not discard what the member was
writing. Draft identity is always scoped by the confirmed account plus the exact
conversation placement:

- one main draft per account, acting Human Profile, and Space;
- one independent draft per account, acting Human Profile, Space, and thread;
- one draft per account, immutable Organization ID, and Center Agent Task; and
- one provisional account-and-immutable-Organization-ID draft while the Center
  Agent Direct Message Space is still resolving.

The provisional Center Agent draft migrates to the canonical Space identity only
after Web knows the real Space and acting Human Profile. The migration preserves
the newest record and removes the provisional copy only after the canonical copy
is stored. Main and compact views therefore reuse one draft instead of creating
presentation-specific state.

A Space draft retains text, structured Wake/Reference mentions, and the reply
target together. Restoring visible `@` text without its structured relation is
forbidden because it would silently change who is woken or referenced. Browser
`File` objects and local preview URLs are not serializable draft state. Selected
files upload immediately and remain visible as canonical Space Files, but the
unsent message association and local preview are not restored across refresh in
the MVP.

The send path takes an immutable snapshot of the current submission, clears that
draft once, and immediately leaves the Composer available for the next draft.
The next draft cannot send until the current request has a safe outcome, and
neither a success callback nor a projection refresh may clear or overwrite it.
When a definitive unsent failure returns and no next draft exists, Web restores
the failed submission to the Composer. When the member has already started the
next draft, Web preserves that draft and keeps the failed submission visibly
marked **Message not sent** instead. Outcome-unknown submissions remain pending
under their original idempotent identity. Center Agent Task continuation clears
only after Core accepts the continuation. An authentication boundary clears all
private Composer drafts before the next account can render. Invalid or corrupt
records are removed. Unavailable or full `localStorage` remains observable but
does not block normal authoring or sending. Composer drafts never authorize
access, enable a mutation, become offline send replay, or replace current Space,
thread, membership, Task, or execution reads.

The Center Agent page may accept one plain-text message while Core is still
opening the real Center Agent Direct Message Space. That message remains an
organization-scoped browser pending item; the optimistic shell must not guess a
Space id, member profile, DM state, or delivery success.

After Core returns the canonical DM Space and acting member profile, Web hands
the same text, creation time, and `clientMessageId` to the standard Space
composer/send path. There is no Center-Agent-only message endpoint or second
send writer. A failed DM open keeps the item unsent, and a failed Space send
must restore it through the normal composer recovery instead of dropping it or
showing it as delivered.

Web setup handoff uses the shared setup flow copy from `packages/start`.
Because users manually copy and run the CLI command from Web, the Terminal
output is part of the Web onboarding experience: Web page labels, bootstrap
script status lines, and CLI Human View progress/completion copy must stay
aligned through the shared setup copy model instead of separate Web-only prose.

Web Space lists and sidebars must read Account Space Index, the Core projection
from Space truth. Browser state and cached history may support interaction, but
they must not become a second source for Space visibility or deletion status.

Account Space Index also carries the nullable irreversible Direct Message
conversion timestamp. A DM-origin row is listed under Direct Messages only when
that marker is absent and the active-member count is exactly two. A converted
row is an ordinary Space even if its membership later returns to two.

Space membership and local-agent availability surfaces should stay responsive by
combining immediate write-response cache patches with live invalidation frames.
When Web creates or adds an Agent Profile to a Space, the successful
`addMembers` response may be applied to the current members snapshot immediately
so the new member appears without waiting for a slow follow-up refresh. Any
missing Wake availability must remain unknown/checking until Core's readiness
read model returns it. For a newly created Agent Profile that Web just bound to
a local controller and added to the Space, the immediate mutation cache patch may
show `Checking` until the follow-up readiness refresh completes. Web must not
show `Offline` merely because the mutation response is missing or racing
readiness evidence. Live invalidation frames may trigger members/status
refetches, but they are not state and must not replace the Space/Core read
models.

Bootstrap member cache seeding is lower-fidelity reconciliation, not
authority. When an incoming Agent item omits Wake availability, Web may merge
its basic fields but must not erase richer controller, runtime, readiness, or
activity display evidence already read from the owning projection. An explicit
incoming Wake-availability verdict replaces the cached verdict; cached
`Available` state must never hide it. The current merge has no freshness order
between competing explicit verdicts and can briefly retain removed members
until the canonical members query refetches. Treat both as known Web projection
gaps: cached rows must never authorize Wake or membership mutations, and a
future fix must add explicit snapshot freshness and member-set reconciliation
instead of another client-side readiness source.

The Add members surface may present the designated Center Agent in its own
category, but the Organization directory result is display data, not mutation
authority. Web must carry the displayed Center Agent Profile id as the expected
designation identity and let Core reject a mismatch. Web submits one mixed
human/agent selection through the shared Organization Directory profiles
mutation; Core resolves the selected Directory identities and either performs
one Space member write or rejects the whole selection. Web must not fall back to
caller-owned Profile resolution or independent per-category writes. The caller
must still be an active member of the target Space when the Space Durable Object
performs the member write. The picker uses a bounded candidate projection
containing only the Profile and display fields needed for selection; it must not
display or search email, Organization role, or other Directory administration
fields. Only each member's default human Profile is a valid human candidate.

Web should make the main product promise obvious to the user: an Agent Profile
is useful when it can be woken from this Space and produce a visible reply,
explicit visible stopped outcome, or explicit visible failure.

Every Web surface that can open Profile creation reads Auth's
`GET /v1/profiles/capabilities` projection. When additional Human Profile
creation is disabled, Web opens the shared creation dialog directly as Agent
creation without rendering a redundant single-option kind selector, and hides
Human-only creation buttons. When both kinds are available, Web renders the
kind selector.
Loading or failed capability reads fail closed for Human creation. UI gating is
presentation only; Auth still rejects direct or stale-client Human creation
requests.

The Organization **Agents** home has one secondary **Requests** view. It lists
the current member's incoming and outgoing Agent Profile Creation Requests,
shows their source and current status, and exposes only the actions the member
may perform: approve or decline as target owner, cancel as requester, retry a
failed request, or open the created Agent. A request deep link from Inbox opens
and focuses this same view; Web does not add another request-management home.
An approved request is shown as **Creating Agent** and offers no cancellation
action because Web treats approval as an active creation handoff. Core may still
be between the durable approval write and its compare-and-swap creation claim;
the recovery scan covers that gap as well as an abandoned claimed attempt. Any
handoff that Core cannot finish becomes an explicit failed request with Retry
instead of remaining indefinitely approved.

**Request Agent for teammate** starts a new-Session request for an exact member
from the current Organization directory. Existing-Session selection belongs on
the authorized Agent Activity Session surface once that projection is ready;
Web must pass its exact provider-native Session ID and chosen `resume` or `fork`
strategy without creating a browser-local Session identity.

**Settings → General → Agent creation approvals** gives every member separate
**New sessions** and **Existing sessions** policies with **Ask every time**,
**Automatically allow**, and **Never allow** choices. Web reads and writes the
Core preference; it does not infer approval from role, friendship, request
source, or prior decisions.

For Profile Details dialogs, Web should consume the shared Profile Details
snapshot or section model from the shared contract layer. Web may render the
dialog, copy buttons, scrolling, and disclosure states, but it must not decide
Profile identity, Space membership, Wake availability, Binding, or local
connection truth by stitching unrelated browser-side facts together.

Profile Details includes immutable **Created by** and **Created from** rows.
They describe the actor and initiation surface, not the owner or current
Binding. The Advanced view may expose the exact actor Profile ID for diagnosis.

Agent Profile creation and maintenance surfaces may render Agent Controller
Permission Mode after the user has chosen a controller. Web should use the
shared runtime metadata so each controller shows native labels and descriptions
instead of a Web-authored abstraction. Existing Agent Profile cards should show
a compact provider-specific line such as `Codex permissions mode: Approve for
me`, and owner-self details may show the richer Binding fact. Web writes the
mode through the Binding API; it must not treat the selected mode as Space
permission, Wake readiness, or local service truth.

Controller replacement, unbinding, and working-folder changes are disruptive
execution-target actions. Agents pages and Space maintenance dialogs must read
the account-wide execution-state projection rather than deriving a lock from
the current Space's Wake list. An unavailable projection disables only those
disruptive controls. The Core writer remains the final guard against stale
browser state; Web must not present a rejected write as saved. That writer
acquires owner-shard execution-target mutation admission, so a Wake that starts
after Web's eligibility read still blocks the disruptive change. A working-
folder timeout remains an unknown outcome until the lease expires; Web shows
the failed save and must not imply that a concurrent Wake is safe. Model,
reasoning, collaboration, permission, and OpenCode permission controls remain
editable while an Agent is working. Model, reasoning, collaboration, and
OpenCode permission changes apply to future work after local synchronization.
Agent Controller Permission Mode may also affect later tool requests in an
active session when the local adapter supports a native live update, but Web
must not claim that a specific session changed because it does not own the
adapter acknowledgement. A permission request that was already waiting remains
separate and still needs its own response.

For Codex Bindings, the same edit surface also renders a separate
`Codex collaboration mode` control with `Default` and `Plan`. Its copy must
explain the user outcome: Plan can investigate, plan, and ask structured
questions in the Space, but implementation waits until the owner switches back
to Default. Saving, reconnecting the same Codex controller to another local
runtime, and Center Agent-managed edits preserve this field independently from
Codex Permission Mode. Equivalent readiness refreshes must not reset unsaved
dialog edits. Web reads the editable value from the owner Binding projection,
not the unversioned readiness projection. Web must not relabel Plan as a
permission preset or change one setting when the user edits the other.

When Web opens Agent Profile creation from an organization-scoped creation
surface, including Agent Profiles and Space member creation flows, Web must
preserve both ownership facts: the signed-in account owns the Agent Profile,
and the explicitly selected Organization contains it. Web must create the
Profile in that Organization before it creates or authorizes a Binding, and all
later working-folder, Default Project, Wake-access, and Space-membership writes
must keep the same Organization id. Web then authorizes the new Binding when
the user confirms or when the user's per-Organization auto-authorization
preference is already enabled. An unbound Agent Profile still belongs to its
Organization, but it has no Binding to authorize and must not be presented as
wakeable until the user connects a local agent.

Web treats the successful Auth Profile create response as an irreversible
creation commit point. It then records Space membership, local Binding,
working-folder, Default Project, and Organization Wake-access work as explicit
follow-up outcomes for that same Profile. A follow-up failure must close the
create transaction as partial success, refresh the committed Profile into the
relevant lists, and show recovery copy that says what did and did not finish;
it must not leave the form in a state where submitting again creates a duplicate
Profile. For Space-originated creation, Web attempts the human-authorized Space
membership write before optional local setup. This keeps the new participant
visible in the Space even when the selected computer or Agent Controller goes
offline between form selection and Binding creation. A Space membership failure
still surfaces the committed Profile and directs the user to add that existing
Profile from the Members panel.

## Space And Thread Presentation

Web presents a Space as a collaboration room and visible outcome surface.

**Space information** presents the canonical Space name. The creator profile,
or the owning Human Profile for an Agent-created Space, gets an inline editor
that trims the submitted value and enforces the shared non-empty 80-character
contract. Other viewers see the name read-only. Center Agent Direct Messages
always use the read-only presentation because their metadata is immutable.

Every current Direct Message uses the same read-only name, access, lifecycle,
leave, delete, and member-removal presentation. Adding selected Organization
Directory Profiles remains available, but submission first opens the explicit
**Turn this Direct Message into a Space?** dialog. The dialog identifies the
new participants, explains existing-message and file visibility, requires a
valid Space name, and warns that conversion is irreversible. Cancel performs no
mutation. Confirm calls the dedicated atomic conversion contract and
applies the successful response to the current status, bootstrap, and Account
Space Index caches before replace-navigating immediately to the ordinary Spaces
route. Members, status, and Account Space Index refetches reconcile in the
background and must not hold the user on the Direct Messages route or relabel a
completed conversion as failed. The converted Space remains member-only; Web
must never describe or present the conversion as making it public. Center Agent
Direct Messages expose no conversion control.

After a successful rename, Web applies the canonical mutation response to the
current Space status cache, then reads Space status again and invalidates the
account Space Index so the current header, Space lists, history, and reference
labels converge on Space-owned truth. A follow-up refresh failure does not
relabel the completed rename as failed. A `space.meta.changed` live frame
performs the same targeted status and index refresh in other open clients; it
does not carry a replacement name or require a members refresh.

Authenticated Space app entry uses the selected active OpenMeld Profile from the
current account. That selected profile can be a Human Profile or an Agent
Profile. Web must not treat Space app access as human-only; Human Profile
fallback belongs only to Start/Join recovery when a link points to a profile
that is not available in the signed-in account.

Web uses `DitherProfileAvatar` only for resolved Human Profiles and the Center
Agent. It derives the artwork from
`openmeld-dither-profile-avatar:v1:{profileKind}:{profileId}`. Human Profiles
add initials and keep an uploaded image authoritative; the Center Agent adds the
generic agent glyph and always shows the generated artwork. Ordinary Agent
Profiles keep the bound Codex, Claude Code, Grok Build, Cursor, or OpenCode logo, with the generic
agent fallback when the controller is unknown or unbound. An unresolved
placeholder must stay a placeholder instead of inventing a generated Profile
seed. Authenticated Space surfaces resolve the Center Agent from the current
Organization's designation or Direct Message projection. Public Space surfaces
use the optional Center Agent identity from the Space status projection. No
surface may infer that identity from a Profile name or the Space kind.

It should keep the familiar conversation model clear:

The authenticated Space header exposes **Messages | Graph | Files** as one
keyboard-accessible tab list. Files keeps the same Space header and membership
context; it is not a Resources redirect or a second app shell. Opening Files
loads the Space root, and opening folders uses breadcrumb navigation without
changing file identity.

The initial Files surface supports native file upload, whole-surface drag and
drop with a visible drop target, folder creation, download, Markdown-file
creation, supported text-file editing, rename, move, and move to Trash. Trash is
a separate member-only view with concrete deletion attribution and one-click
restore; it is not shown to public or Organization-only viewers. Each active row
shows the concrete type, size when applicable, latest revision, last editor, and
update time. Empty, loading, permission, network-failure, upload-progress, and
conflict states use plain product language and one next action. Read-only Space
viewers see the active tree without mutation controls. Image rows use the
current revision as their visual thumbnail instead of a generic file icon. In
the conversation, canonical image references retain the familiar inline image
preview and morph into a focused full-size view when selected; non-image
references remain file cards, and both presentations lead to the same canonical
entry in Files.

Markdown creation and editing reuse the exact rich Plate surface owned by the
Organization Documents experience. Both surfaces persist one CommonMark + GFM
string, expose only formatting that round-trips through that contract, and use
the same toolbar, slash commands, keyboard behavior, placeholder language, and
read-only presentation. JSON, YAML, XML, and plain-text files stay in a source
editor so Web never presents structured source as rich prose. Shared MIME
inference recognizes common file extensions when browsers omit `File.type`, so
an uploaded `.md` file opens in the Markdown editor consistently with CLI.

Text editing keeps the loaded revision. Save sends that revision as the base;
on `space_file.conflict`, Web keeps the user's unsaved text, explains that a
collaborator saved a newer version, and offers to reload the latest content or
copy the local draft. Web never retries a stale save automatically. A
`space.files.changed` frame invalidates the current file query and never edits
browser state directly. **History** opens a temporary right-side drawer instead
of permanently shrinking the editor. Selecting an older revision closes the
drawer and previews that snapshot read-only in the main surface. A member may
restore it as a new latest revision without erasing later revisions. The header
uses the viewer's local date and time instead of a hard-coded timezone.

Returning to the file list, changing **Messages | Graph | Files**, opening a
different chat file, following an internal route, reloading, or closing the
window with a local draft uses the same save, discard, or cancel contract as
Organization Documents. A repeated click on a chat file card reopens its exact
sent revision even after the viewer temporarily returned to the current file.

- the main timeline shows root conversation messages
- `Reply to` creates a normal reply relation to a message
- `Reply in thread` opens the thread panel
- thread replies stay in the thread panel
- the root message may show a compact thread preview
- the main timeline must not render thread replies as standalone root messages

On desktop, the inline Members and Thread panels are resizable from their left
edge because they occupy the right side of the Space. They reuse the shared
sidebar resize mechanics, including pointer drag, keyboard resizing, bounded
minimum and maximum widths, and reduced-motion behavior. Members and Thread
widths are persisted as separate browser presentation preferences. The
Members open/closed state and width are scoped to the current Space id, so
switching Spaces restores each room's last Members layout without changing any
other room. Without a stored preference, Members starts closed at its bounded
minimum width. The Thread width remains a separate Thread-panel preference. The
authenticated centered conversation layout uses the current Members width when
it reserves space, so reopening a resized Members panel does not introduce a
second hard-coded layout width. Opening an inline panel must lay out its content
at the final panel width before any entrance motion; Web may animate only
composited presentation properties such as transform and opacity so labels and
message content never pass through a compressed wrapping state. Reduced-motion
users receive the final layout without spatial motion.

Members header descriptions and Add-members guidance own full-width rows below
their related title-and-action rows. Add-members controls respond to the panel's
own width rather than the browser viewport: narrow panels stack heading actions
and footer actions into full-width rows, while wider panels keep the compact
side-by-side layout. After Core confirms an Agent or Human membership write,
Web collapses Add members so the roster regains the available space. Agent and
Human names use the same compact type scale as the app sidebars so the Members
panel does not introduce a heavier navigation hierarchy.

The active Thread panel selection is a per-Space browser presentation
preference. Web persists only the selected Thread id, resolves that id against
the current Thread projection after reload, and clears the preference when the
Thread no longer exists or the user closes the panel. It must not persist a
duplicate Thread object or treat this preference as Thread truth. The mobile
Members drawer remains a fixed-width overlay and is not part of this inline
resize contract.

Transient Agent stream rows follow the same placement as their
`triggerMessageId`. Web renders a stream only in the conversation scope whose
loaded messages contain that trigger. A thread panel excludes a stream
triggered by its root message because that root still belongs to the main
conversation. The eventual durable reply, stopped outcome, or failure replaces
the transient row in that same scope.

The composer guidance follows the current conversation, not only the main
timeline. In a one-to-one Agent Direct Message, both the main composer and its
thread composer explain that `@` is optional and sending wakes the Agent.
Ordinary Space threads keep the standard explicit-mention guidance.

Every writable Space composer — ordinary Space, Direct Message, Center Agent
Direct Message, and thread — uses the same file control. The former paperclip
is a Plus button labeled **Add to message**. It opens the shared Fluid dropdown
above the composer with a **Files** item so later composer actions can be added
without changing the primary control. The file picker accepts arbitrary files;
paste and drag and drop use the same path.

A composer accepts up to ten files, each up to the shared 10 MiB limit.
Selection immediately uploads each file as a canonical root-level Space File
and keeps a removable local row with image thumbnail when available, file name,
progress, failure, and request id. Sending waits for every selected upload and
allows a file-only message without invented caption text. A failure never
silently publishes a text-only or partially attached message.

After upload, Web submits only server-returned Space File references. A pending
outgoing message may use a local image preview until the canonical signal with
the same client message id arrives. Durable message cards fetch an image
thumbnail from the exact sent revision when appropriate and otherwise show a
file icon, name, size, revision, and **Open in Files** affordance. Selecting a
card changes the same Space to Files and opens the canonical entry; public
viewers receive the same navigation in read-only mode. Image entries render an
in-product preview, Markdown entries reuse the shared rich editor, and other
binary entries retain the explicit download path.

Existing `attachments` fields remain a read-only compatibility surface for old
messages and are not migrated. New Composer uploads use `files`; Web must not
derive either contract from Markdown, project Space Files into Organization
Documents, or maintain a second message-owned byte copy.

Full message bodies recognize the canonical relative Space reference
`/spaces/<64-character hexadecimal spaceId>`. Web renders that reference as an
internal link only after the current Space or Organization Space Directory
or account Space Index proves the target is visible to the viewer. The link
shows the Space name when available, otherwise a shortened ID; pending, failed,
or missing resolution keeps the original path as plain text. Anonymous public
views can prove only the currently open Space and therefore keep other
references as text. The same message reference entity is reused in ordinary
Spaces, Direct Messages, threads, reply previews, thread previews, and message
details. Existing messages that contain the legacy singular
`/space/<spaceId>` form may still render, but new product output must use the
canonical plural path. Browser notifications use the bounded Inbox title and
preview as operating-system plain text and are not a rich message-body surface.

Web renders trusted Agent-authored message bodies as safe Markdown in ordinary
Spaces, Direct Messages, and threads. This presentation rule is independent of
whether the message is a durable final Agent reply: the final-reply marker
continues to gate execution-outcome presentation such as Navigation Actions and
durable Agent work details. Human-authored message bodies remain plain text.
The shared safe Markdown renderer strips raw HTML, does not render Markdown
images, and applies the existing link and internal Space-reference policy.

For an authenticated Organization view, a resolved reference navigates to the
app route `/o/{orgSlug}/spaces/{spaceId}?profileId={activeProfileId}`. The
canonical message token remains `/spaces/{spaceId}`; message authors and the
Center Agent must not hard-code viewer-specific app URLs. If an initial
Organization Space Directory projection is still loading or stale, Web renders
the app link immediately with a shortened Space ID, then replaces that label
with the resolved Space name. Web may perform one bounded refetch for newly
observed unresolved references, then respect the refresh cooldown. Anonymous
views keep the public route behavior.

An Organization Wake-access failure is actionable configuration, not a
destructive system crash. Space outcome rows present it in amber, state that
Wake access is off in plain language, and link directly to Organization Wake
Access. Other terminal execution failures keep their own severity.

Thread placement is conversation placement. It is not execution truth.

For a hosted Center Agent Space reply, Web may overlay live model thinking and
accumulated stream text while the turn is active. Neither projection is a Space
message or final outcome. Thinking appears inside the Agent bubble as a
collapsed `Thinking…` disclosure with the latest text visible in its summary;
opening it shows the bounded live content. Web never writes thinking to its
persisted browser read cache or a durable message, and removes it as soon as a
terminal frame or durable outcome arrives. Reconnect restores the privacy-safe
active stream presence and any accumulated text; thinking is not replayed from
bootstrap.

For hosted Center Agents and workstation Local Agents, Web may also show one
compact live **Work summary** from the sequenced Space stream. A row describes
the actual user-meaningful work, such as `Searching GitHub issues…`, `Running
project tests…`, or `Cloning amplifthq/reply…`. Web renders only the shared
semantic work key and its explicitly safe subject label. It never derives copy
from a tool name and never renders a raw tool name, Code Mode wrapper, command,
path, input, output, error, or private Agent text. A tool lifecycle part without
an admitted work meaning is invisible; there is no generic `Used a tool`,
`Ran a command`, `task complete`, or `task ran into a problem` fallback.
Connected App discovery names the App, and Connected App execution names both
the App and its normalized catalog action. If either safe meaning is missing,
the call is invisible instead of falling back to `connected app action`.

The live Work summary shares the existing progress row instead of adding a
second row and preserves the same Stop control and Message details action
without shifting the conversation layout. While the authoritative stream is
active, that row keeps `Agent is working` as its stable primary state and shows
the concrete current work as supporting context. Work activity must never
replace or hide the active execution state. The summary defaults open inside a
bounded scroll viewport no taller than 12 rem or 30% of the dynamic viewport.
Web first reconciles lifecycle parts by tool-call identity so starting and
completed evidence for one call remains one step. It then groups only
consecutive calls with the same semantic work, safe subject, and lifecycle
state; a success and failure are always separate, exact rows. Web retains at
most the latest 50 admitted live calls. New work follows the bottom while the
user remains there; scrolling up pauses following and shows one
`new step · Jump to latest` control instead of pulling the user away.
Reduced-motion preferences disable smooth following. The summary does not
create an empty message bubble before text arrives in ordinary Spaces or
threads.

For a durable final reply, Web prefers the complete
`signal.text.data.meta.agentWorkSummary` projection. It reads the legacy
`agentActivity` field only when the complete field is absent, so cached older
replies remain readable while current Connected App work keeps its required
concrete App and action meaning.

An inner Code Mode tool call may appear only when that inner call maps to an
admitted work meaning and has actually succeeded; the outer Code Mode call,
inner failure, and their lifecycle or error never appear. A final collapsed
summary names one failed admitted step directly, or shows a failure count with
a details cue when several steps failed. Runtime permission denials remain
explicit Wake outcomes with the shared Agent Profile permission recovery across
Codex, Claude Code, Grok Build, Cursor, OpenCode, and future controllers. A work row must
not infer permission guidance from a generic command-tool error, and Web never
changes permissions automatically. Because every message in a one-to-one Center
Agent Direct Message implicitly wakes the Center Agent, its source message omits
the redundant `woke Center Agent` receipt. The Direct Message may derive one
optimistic reply shell from the active Wake presentation immediately after the
user sends. The shell shows only the already-known Center Agent identity and one
compact animated status row. That row uses the existing `Agent is working`
presentation continuously from local submission through queueing, connecting,
admission, and active streaming, and reserves one stable Stop-control slot so
transport evidence does not move the conversation or introduce a second
near-synonymous state. In this Center Agent Direct Message shell, the copy is a
conversation-level progress placeholder, not a browser-owned claim that worker
admission already completed. Authoritative transport diagnostics still
distinguish direct, Queue, fallback, and admission stages. Web does not invent a
reasoning state or a client-owned elapsed counter. The
optimistic source message itself is sufficient immediate send feedback and must
not add a short-lived
`Sending...` row; if delivery remains pending for eight seconds, Web may add
`Still sending...`. The source message must not render a second Wake progress
row while this shell is active. The shell is not a Space message, stream event,
tool activity, reasoning claim, or execution authority; Web must never persist
it or show it in a non-Center-Agent Space. The first authoritative stream
projection, durable reply, stopped notice, or failure notice replaces the shell,
and the shell must disappear when its active Wake presentation ends. An empty
active stream keeps `Agent is working` instead of renaming that state to a
generic `Responding...`. Partial reply text,
a transient output
preview, and concrete live tool activity are supporting context; none means the
active execution has ended. The row therefore keeps one explicit
`Agent is working` presentation and the same Stop control until an
authoritative terminal outcome replaces it. A transient output preview uses one
line as `Agent is working · <specific preview>`. Once the authoritative stream
is active, its other phases use the same hierarchy, for example
`Agent is working · Finalizing reply`; they must not replace the execution state
with the phase alone. Outside the Center Agent Direct Message shell,
pre-execution Wake phases such as queueing or connecting keep their exact phase
copy and must not claim that the Agent is working. When
the latest admitted semantic tool step settles, the live Work summary keeps its
concrete completed or failed meaning instead of inventing a generic
response-preparation phase. Because the Work summary header owns expansion, an
adjacent Message details action remains available as a distinct control during
live tool activity instead of overloading or removing either action.
The Space bootstrap snapshot seeds active stream projections in the same room
entry read as recent durable signals; Web must not issue a separate
conversation-state request. Web requests
`includeAgentStreamPresence=true`, uses the returned privacy-safe presence to
keep a thinking-only or tool-only Agent row visible on the first frame after a
refresh, and preserves its authoritative `createdAtMs` when later live frames
arrive. A missing presence field is a mixed-version response, not proof of an
active stream. Live frames update the seeded projection without overwriting a
newer sequence. Private thinking and the compact live Work summary are not
replayed on reconnect. A successfully published Agent reply may carry a durable
privacy-bounded work projection. Web renders the reply body first and then one
collapsed Work summary so historical steps cannot displace the answer.
Reopening it shows the latest five grouped steps and offers
`View all work details` when the retained projection is longer or truncated.
Message details uses the same semantic copy in its unified **Activity** timeline
and may show the retained timestamped work projection for 14 days. It never
falls back to a technical tool journal. Web omits work events for older replies
where semantic work was not recorded and for messages where it does not apply.
This Space reply work projection is not the separate **Agent Activity**
product. A durable Space reply,
stopped notice, or failure
notice must replace the overlay; a terminal frame alone must not become
refresh-stable history or be labeled as the durable final reply. Slack streams
never appear in a Space timeline.

A Wake from inside a thread should preserve that conversation context. The
default visible outcome for that Wake belongs back in the originating thread
unless the Space collaboration owner defines a different product rule.

`terminal_failure` and `wake_stopped` notices use the same compact outcome-row
presentation in the main timeline and thread panel. When `replyTo` is present,
the row is anchored under its source message; otherwise it stays at its own
timeline position. Web renders Core's `text` directly, uses `reasonCode` only
through the shared recovery mapping, and uses `failureStage` only to distinguish
execution failure from OpenMeld publication failure. Read-only viewers must
still see the outcome.

A persisted terminal system failure is visible in that outcome row without
hover and remains visible when the timeline is loaded again after refresh. Its
Message details recovery is state-aware and always includes `Open diagnostics`;
it must not reuse an Agent Profile configuration action such as
`Review agent settings`. A late result does not rewrite that failure's reason.
Web correlates the original `terminal_failure` with a separate nonterminal
`execution_recovery_available` notice by exact dispatch, target, and result
reference, then inspects Core's current Execution Recovery projection. It
suppresses generic Retry only when that projection exposes a higher-priority
action. It shows **Recover result** only when Core exposes the authorized
durable-result recovery command; a setup/reconnect link is not that command.
That automatic inspection is a background capability check, not a user action.
If it fails, Web keeps the failure scoped to the unavailable recovery control:
it shows no toast, banner, or disabled `Recovery unavailable` action and does
not tell the user to open diagnostics merely because the check failed. The
original terminal outcome and its existing Message details remain unchanged.
When Core instead exposes a verified exact-controller continuation, Web shows
**Recover reply** and explains that the same Agent conversation will post
its already-finished reply without running the task again. Web accepts the
legacy **Continue conversation** projection during mixed-version rollout but
normalizes it to **Recover reply** for users. It preserves the terminal failure
rather than presenting retained evidence as an already-published reply. The
recovery notice never creates a second terminal outcome row.

Message details presents one cause-specific primary action per failed target,
plus **Open diagnostics**. It must not pair unrelated actions: a Cursor plan
limit opens Cursor plan management, a setup problem shows the exact relevant
setup action, and a reply-publication failure shows exact reply recovery when
available. These controls use the same button height and visual density.

The recovery action is owned by the exact
`dispatchId + targetProfileId + resultRef` key. Timeline, thread, and Message
details reuse that key and one deterministic operation identity. Only one CTA
for that key may be visible at a time: opening Message details moves the action
there and hides the timeline copy; closing it restores the timeline copy.
Pointer, touch, keyboard, and rapid repeated activation all enter the same
pending fence and issue one execute command.

A single terminal execution failure with no recoverable result shows
**Retry as new execution** inline when Web can
recover the exact source text and exact target Agent Profile. That action
is labeled **Retry as new execution**, creates a fresh Wake with a new
client-message identity, and makes clear that the request will run again. Every
transport retry
for that one action reuses the same identity. If Web cannot confirm the outcome,
it shows `New execution not confirmed. Try again`; selecting that action
redrives the same identity instead of creating another logical Wake. Only a
definite failure clears the identity before another Retry. Grouped failures,
stopped outcomes, publication failures, and outcomes without an exact source
and target omit inline Retry rather than guessing what to rerun. `Open
diagnostics` expands and focuses the retained technical details, including the
bounded reason code, while raw internal error text stays out of product copy.
If the fresh Retry request definitively fails, the action must show that failure
visibly and remain available for another attempt; console logging alone is not
a user-facing outcome. Outcome unknown is not definite failure.

When a persisted Agent Profile reply carries server-authored reply staleness
context, Web may show the quiet `written before N newer messages` marker next to
that reply. Web reads the shared signal field; it must not count browser-local
timeline items, author the field, or reinterpret the marker as execution failure
or reply ordering authority.

When a persisted hosted Center Agent reply carries the server-authored
`conversationCompaction` checkpoint, Web inserts one quiet separator
immediately before that reply with the exact copy `Conversation compacted`.
The main timeline and thread panel use the same marker component and placement
rule. The marker breaks visual message grouping across the compaction boundary,
remains visible after refresh, and does not become a second Signal or system
notice. Web coalesces a checkpoint count greater than one into the same single
separator.

Web must not infer compaction from message length, token estimates, elapsed
time, missing history, stream events, or browser state. It does not show a
transient `Compacting...` status, spinner, progress row, toast, or banner.
Replies without the optional checkpoint remain unchanged, including replies
from older Core or Remote Agent deployments.

Web must also preserve Space action semantics. `post_message` is for answers,
discussion, and final replies. `post_status` is only for short work-state
updates. A status update must not be presented as the answer, and `ready` must
not be used as a status.

## Wake Authoring And Details

Web must preserve the submitted difference between Wake and Reference.

A Wake creates executable work. Reference creates collaboration context, not
dispatch work. Web must not silently rewrite Reference into Wake.

The primary Space composer `@` picker optimizes for the common user action:
selecting an Agent Profile authors Wake by default while keeping the visible
composer text as a plain `@Name` mention. The same picker surface exposes the
other allowed relation without a required second dialog: Wake uses `@`, and
Reference uses a link-style symbol. Human Profile selection cannot create Wake.

After selection, Web renders one persistent editable semantic control per
structured target. The control identifies both the target and its current
relation, and a multi-target message shows a quiet summary such as
`Waking 3 agents · Referencing 0`. Web submits the structured relations
explicitly instead of relying on Core to infer Wake from arbitrary bare text.
Changing a semantic control changes the authored structured relation; AI
interpretation must never silently rewrite it.

For Web-authored Wake messages, Web must create and preserve a non-empty
`clientMessageId` before the first network hop. That key is the browser-authored
user-action key for later trace lookup.

One message can Wake multiple Agent Profiles. Wake details are therefore
target-specific once the target profile is known.

Message details is one controlled right-side drawer for every visible message,
not separate ordinary-message and work-message surfaces. The drawer reads the
shared Message Details response, builds one presentation model, and renders one
Activity timeline beginning with the actual message preview, author, and sent
time. Each Wake target receives one Activity row. Transient work updates that
row in place while the target is active; the recorded reply, failure, stop, or
other terminal outcome then replaces the transient content in the same row.
The final status, reply preview, failure explanation, recovery action, and
diagnostic action stay together on that target row. Web must not render a
separate Replies section, a detached `Why this failed` summary, or an extra
`replied` event for the same final reply. Transient live progress can enrich
that presentation model but cannot become a second status source or final
outcome.

Every Space also exposes **Messages** and **Graph** as two views of the same
loaded timeline projection. The product and implementation term is `Graph`.
Web projects ordinary messages, reply relations, structured Wake targets, and
recorded target outcomes into Graph nodes and edges without adding a separate
Graph endpoint, cache authority, or work-only object model. Clicking a message
node opens the same Message details drawer used by Messages. Message details
provides a `View in Graph` action that switches views and frames the selected
message with its directly connected collaboration. The source-message and
reply rows provide compact jump actions back to the corresponding message in
Messages.

The primary Space composer renders only in Messages. Graph receives the full
remaining panel without a duplicate composer, while the existing browser-side
draft, selected files, and reply target stay intact for the user's return to
Messages.

Available contextual setup guidance also renders only in **Messages**. In an
ordinary Space with no messages, Web centers the Space explanation and the
planner's available setup actions in the conversation canvas. Those actions use
`@openmeld/ui` `FluidCardGroup` / `FluidCardItem`, with transparent card content
so one shared layout background moves between hovered or focused cards. Once a
recorded message exists, remaining guidance sits in the conversation scroller's
shared top-overlay stack with earlier-history loading, reuses `ProgressiveBlur`,
and does not consume timeline layout height or add an opaque banner background
or structural divider. Its interactive content remains above the blur while
messages remain visible behind it. The overlay begins at the top of the
conversation region; it must not add a transparent navigation-height inset that
allows scrolled messages to appear above the blur. Both presentations consume
the same planner decisions and handlers. When **Graph** is active and setup remains available,
the Space header shows **Get set up**; activating it returns to **Messages** and
recalls the guidance without changing planner or setup truth.

Current Direct Messages never render `bring_agents` setup guidance. A DM with
the current account's own local Agent Profile may render only
`connect_this_computer` when needed; human-human, other-owner-agent, and Center
Agent DMs render no generic setup panel. Adding a third participant remains an
intentional collaboration mutation through the conversion dialog, not an
onboarding shortcut.

Only recorded Space signals become Graph message nodes or open Message details.
Pending messages, optimistic Agent shells, and live Agent streams may annotate
an existing Wake target while work is active, but Web must not present those
transient projections as durable messages. A publication retry is presented as
posting, not as a final failure. Graph retains one Agent activity node only
while the target has no durable terminal outcome. Once a recorded reply,
failure, stop, silent outcome, or handoff exists, the source message connects
directly to that recorded result; Graph must not preserve a redundant
`Replied`, `Failed`, or `Completed` Wake node between them. Structured statuses
and system notices keep their recorded event semantics.

The Space header presents those views in a stable two-row hierarchy. The first
row contains the Space name, access mode, live connection indicator, and
right-aligned actions. The second row contains Messages and Graph below the
Space name. Those view labels align with the Space name and use a flat active
underline that overlays the header divider. The Members action shows the active
member total from the Space member projection. The header and Space sidebar do
not repeat `Joined as` or an aggregate live-human count; speaking identity stays
with the composer when a choice is available, and per-member presence belongs
in the Members surface. When dismissed contextual setup remains recallable,
**Get set up** appears in the right-aligned action group immediately before
**Members**. On compact screens only, the same recall control may move to the
trailing edge of the second header row so the Space name remains identifiable;
it stays visually separate from the **Messages** and **Graph** view control and
returns to the primary action group at wider breakpoints.

The Space header, main conversation rail, contextual setup overlay, and primary
composer share one responsive inline frame. Its leading inset is the leading
edge of the Space identity icon; Full Width must not introduce a wider inset,
and Centered mode may add only its intentional centered max-width margin. When
Members, Thread, or the browser viewport compresses the conversation, content
may reflow inward but must never extend past that shared leading edge.

React Flow (`@xyflow/react`) is the Web renderer for this projection. It owns
viewport interaction and browser-local node layout only. Nodes are draggable;
the canvas supports pan, zoom, fit-to-view, keyboard accessibility, and a
bounded minimap when the loaded graph is large enough. Web disables user-created
connections because moving or connecting presentation nodes must not mutate
Space relationships. Web derives weakly connected groups only from the projected
reply, Wake, and result edges. It lays each group from left to right and packs
unrelated groups from top to bottom, without inspecting message text or
inventing coordination. The initial viewport frames the group with the latest
recorded activity; the standard fit control still frames every loaded node.
When the user opens Graph from Message details, Web frames the selected message
and its one-hop connected nodes, visually emphasizes that collaboration, and
de-emphasizes unrelated nodes without removing them. Message cards use the
recorded author or target Agent Profile avatar or icon so the same participant
is recognizable across Messages, Message details, and Graph.
`Reset layout` recomputes that canonical arrangement and clears only the current
Space's browser-local node overrides. Node positions otherwise remain stable
while the current Space is open and reset when Web changes Spaces; they are not
Space truth and are not persisted as messages or execution records. The first
release visualizes only the currently loaded root timeline and must not imply
that unloaded history or thread-only activity is already in the canvas.

The drawer must keep the message author and each Wake target as separate facts.
An Agent-authored handoff can therefore show one author Agent Profile and a
different target Agent Profile, even when there is only one Wake target. The
Activity timeline shows each target explicitly, while technical details qualify
author execution fields as message-author facts and target execution fields as
Wake-target facts. Web must not infer either role from the other or collapse
them into one generic Agent identity.

A Wake details query key must include:

```text
spaceId
clientMessageId
targetProfileId
openMeldProfileId when present
```

Protected Space passwords, secrets, message text, prompt bodies, and arbitrary
payloads must never be included in query keys.

Protected Space access authorization is Core-owned. Web may keep an encrypted
short-lived protected-access cookie for anonymous or not-yet-member password
entry, but signed-in creators, active members, and same-account members should
be allowed by Core membership proof without repeatedly asking for the Space
password. Web must not turn the cookie into a second authorization source of
truth.

Wake details and waterfalls help the user understand what happened to one Wake.
They must show evidence as evidence: queued, routed, delivered, running,
replied, failed, missing, pending, or degraded.

Active Wake progress must survive browser refreshes by reading the Core/Space
Wake progress read model. Browser-local progress state may provide immediate
feedback for a just-submitted Wake, but it must not be the only source for an
active running, retrying, writing, publishing, replied, stopped, or failed Wake
state. Web must not convert an aging Core-owned active state into a local
terminal timeout or claim that the Agent did not respond; it remains active
until Core projects a reply, stopped outcome, or explicit failure. Only a
short-lived browser-local optimistic `sending` item may expire locally. When
Web shows elapsed running time, it uses the optional authoritative
`startedAtMs` timing projection requested with `includeTiming=true`.
`updatedAtMs` remains progress freshness and ordering evidence; Web must never
reinterpret it as the execution start time. A mixed-version response without
`startedAtMs` omits elapsed time instead of inventing a browser-local timer.

When active Wake progress includes a pending Agent Interaction for the current
Binding owner, Web projects it into one collapsed Pending Action Surface above
the currently visible main Space Composer or active Thread Composer. Web mounts
that one surface in exactly one panel; opening a Thread moves the projection
beside that Thread Composer instead of leaving a second entry behind the side
panel. The surface reuses the existing Permission, Question, and Plan Review
cards, stays closed until the owner opens it, and presents multiple requests one
at a time. Its selection and component identity use
`runtimeCoordinatorExecutionId + interactionId`, because separate Wakes may
reuse the same provider interaction id. Web does not create a cross-Space
approval center, duplicate pending state, batch approval, or an automatic
popover. The originating message or thread remains context, not the location
the owner must rediscover to respond. Other members continue to see only the
safe inline waiting indication.

Permission cards show the native choices; question cards collect every answer
in bounded steps; plan cards show the bounded plan and support approval or
change feedback. Web posts the shared response to the Space interaction
endpoint, disables duplicate submission while it is pending, keeps a failed
submission retryable, and refreshes authoritative progress after success. It
does not continue the Agent from browser state.

For controllers with a native low-interruption Permission Mode, a permission
card may also offer to save that mode for future requests. Web sends the current
response first so the Wake resumes immediately, then saves the Profile setting
as a non-blocking follow-up. A failed setting save does not undo or delay the
response: Web shows a concise error with an `Edit Agent Profile` action that
opens the Profile dialog focused on Permissions. A successful save shows a
lightweight confirmation that distinguishes the saved Binding intent from when
OpenMeld Service syncs it and whether an active local Agent accepts a live
update. Web does not invent a generic mode for controllers such as OpenCode that
own a different permission contract, and it never offers a dangerous mode
through this shortcut.

Only `canRespond=true` plus a non-null private request may render details or
controls. A content-free summary renders only that the Agent Profile is waiting
for its owner. Web must not infer owner authority from Space role, Profile
selection, or cached UI state. Secret questions use a password input and must
not be echoed after submission.

Detailed Wake polling must merge changes to `pendingInteraction` even when the
ordinary lifecycle phase and `updatedAtMs` are unchanged. An unexpired
interaction remains visible and polled beyond the ordinary 30-minute working
presentation window, up to its server-provided expiry. Refresh, route
navigation, or a temporary socket replacement must therefore recover the card
from Core. Answered, cancelled, expired, or terminal requests disappear from
the authoritative projection and therefore disappear from the Pending Action
Surface on every client. Web returns focus to the Composer when a focused
request disappears, but it must not retain a local approval history or build a
second notification system to own this state.

A permanent hosted-publication ambiguity is presented as
`publication_unknown`, not as active retry progress. Web removes the optimistic
reply and spinner, shows that OpenMeld could not confirm whether the final reply
was posted, and asks the user to inspect the Space before trying again.

Web may expose a Wake Stop intent as soon as a sent structured Wake has a single
Space-visible target selector. Web must still opt in to `wakeStopEligibility`
when reading Wake progress and active Wake progress, and explicit not-eligible
or unsupported Core projections remain fail-closed. A missing
`wakeStopEligibility` projection is only a temporary visibility gap: Web may let
the user request Stop through the normal selector, but Core remains the only
authority that decides whether the request becomes OpenMeld-owned pre-agent Stop,
controller-backed running Stop, retry-later, unsupported, or not-stoppable.
Web must not infer stopped, cancelled, or controller support from local browser
state, controller labels, or a previous Stop response.

The Wake Stop request path is `POST /v1/spaces/:spaceId/wake-stop`. Web sends
only `sourceSignalId` or `clientMessageId + targetProfileId`, never
`dispatchId`, task ids, or RuntimeCoordinator execution ids. A typed
`unsupported`, `not_stoppable`, `not_found`, or `retry_later` response is product
state. A raw HTTP 404 is a route/deployment/proxy problem, not normal Wake Stop
unsupported behavior.

Web must not show `cancellation_requested` as stopped. It may show a low-noise
stopping state while waiting for Core to project a stopped progress phase or a
`wake_stopped` system notice. The final stopped outcome must come from the
original Wake message's details/progress context; Web must not create or imply a
fake agent-authored reply.

`runtimeCoordinatorExecutionId` may appear as a correlation field. Web must not
treat it as a token, credential, or execution authority.

## Diagnostic Surfaces

Web Wake waterfall is projection-only.

It reads existing Space signal, dispatch outbox, dispatch lookup, Dispatch
Ledger, attempt, claim, result, and reply facts. It reports which steps are
found, pending, missing, failed, or degraded. It must not write facts, invent a
second trace model, or decide the final execution outcome.

A Diagnostic Report is a user-submitted event about a visible Space problem.

Web may submit only:

```text
reportedSignalId
problemType
```

Core derives `replyToSignalId`, `threadId`, Wake pointers, and dispatch pointers
from existing facts. Web must not send full message text, prompt bodies, or
arbitrary payload dumps.

If Web stores browser-side diagnostic pointers, they must be sanitized:

- `openmeld.space.last-wake-diagnostic` may store `spaceId`, `clientMessageId`,
  `sourceSignalId`, and target profile IDs.
- `openmeld.space.last-diagnostic-report` may store the report ID and derived
  diagnostic pointers.
- neither record may include message text, protected Space passwords, access
  tokens, one-time tokens, Computer authorization codes, cookies, secrets, or
  raw payloads.

These records help users and support return to the right evidence. They do not
create new truth.

## Setup Handoff Entry

Web setup is an entry point into local preparation. It is not local execution
truth.

Web may create a Prepare Session handoff and show a setup command that carries
an opaque session token. That handoff represents the user's intent to align this
browser account with a local CLI or OpenMeld Service flow.

Prepare and Computer authorization credentials remain short-lived. Before a
displayed command expires, Web mints a replacement Prepare token and
browser-approved Device Authorization grant and swaps in the new command. Copy
also verifies freshness and refreshes first when needed, so the user never
copies a command that Web already knows is expired. Expiry is not presented as
a terminal-debugging task.

Every command refresh is fenced to both the stable Computer setup key and the
current Prepare Session ID. If starting over or recovery replaces the Prepare
Session while an older refresh is in flight, the older result must not replace
the visible command, overwrite the persisted session pointer, or satisfy refresh
deduplication for the new session. Choosing `Set up again` increments that fence
before Web requests the replacement session, so the invalidation does not depend
on a later React render or network response.

When setup starts from `Reconnect OpenMeld Service` on an existing Computer,
Web carries that stable `connectedComputerId` into the Prepare Session. A local
service reinstall may report a new `deviceId`; Web still follows the session and
shows completion for the selected Computer instead of creating a browser-side
device match that can leave the page waiting forever.

Selecting a Computer card in a Human Profile is navigation, not a global routing
mutation.
Web must not offer a `Use this computer` action or claim that the browser has
switched computers unless an owning server contract actually changes routing.
Agent Profile Binding recovery remains explicit and per Agent Profile.

When two or more caller-managed Agent Profiles need the same current-computer
recovery, Agents may offer one explicit bulk confirmation. Eligibility must
still be resolved per Agent Profile: the current Runtime must be able to receive
Wake work, the matching local Agent Controller must be runnable on that Runtime,
and Core must have returned `reconnect_binding` guidance for that profile. The
bulk action performs the existing reconnect write once per eligible profile,
preserves same-controller Binding settings and conversations, carries forward
eligible Organization Wake access through Core policy, and reports partial
success honestly. It is a user-confirmed convenience over per-profile writes;
it is not an automatic side effect of service setup, Computer reconnect, or
device-name matching.

An accepted Agent Profile Binding reconnect is a completed cloud save. Web must
not report that save as failed because route-catalog notification or
`AgentExecutionReadiness` has not converged within a browser-side polling
window. Core owns the route-catalog notification issued with the Binding write;
Web then refreshes the primary Binding and canonical readiness projections and
shows their current state without issuing a duplicate notification.

Web does not decide whether the local machine is actually ready.

Once the Prepare owner confirms persisted terminal authentication and aligned,
connected OpenMeld Service identity, Web presents **Computer connected** as the
primary outcome. Agent Controller discovery, controller sign-in or repair
attention, Skills, diagnostics, update state, Project discovery, Binding, and
Core readiness remain independent progressive facts. They may update after the
user leaves the page and must not turn the connected Computer result back into
generic setup failure.

When setup completes with an OpenMeld Assistant bootstrap result, Web reads that
result from the Prepare Session snapshot and may show an `Open OpenMeld Welcoming
Space` action. The URL must come from the persisted bootstrap result, not from a
guessed Space name, a reconstructed path, or local browser state. If bootstrap
failed or no result has arrived yet, Web must not invent a Space URL.

A Web setup or repair surface must not report **Computer connected** only because:

- a command was generated
- a Prepare Session connected
- a local process started
- an installed controller was detected
- capability inventory was observed
- a setup snapshot streamed back to the browser

**Computer connected** must be grounded in persisted Terminal authentication and
aligned, connected OpenMeld Service identity for the account, device, and lane.
Controller capability, Binding, Core readiness, and claim eligibility remain the
independent owner facts for each Agent's availability. They must not gate the
Computer result or be collapsed into a second meaning of setup success.

Web does not ask the user to select local agents during an ordinary setup
handoff. The connected Service's background catalog refresh detects newly
installed supported local agents and connects them automatically while
preserving every existing On or Off choice. Web owns
only the Computers controls that let the user change those choices later;
Binding truth and final readiness still belong to their architecture owners.

When Prepare reports a local-machine blocker whose shared recovery policy is
`user_action`, Web shows the exact shared plain-language issue and one
`Try again` action after the user fixes the computer condition. It resolves
that policy from the shared code-to-policy map instead of maintaining a Web
error-code list. It does not append a second generic reconnect instruction or
ask the user to choose `setup` versus `service repair`. Web cannot free local
storage or change operating-system background-execution permission, so it must
not pretend to repair those conditions from the browser. Retrying starts the
normal Prepare flow; it never silently reruns an existing Wake.

## Desktop Download Entry

Web owns the public OpenMeld Desktop download entry, but it does not own local setup
truth.

Desktop distribution is currently paused. `/desktop` deliberately returns 404;
the page and artifact pipeline remain in the repository for a later, explicitly
approved release.

Current MVP routes:

- `/desktop` is the retained public download-page route and stays behind the
  distribution pause gate until release approval.
- `/desktop/download` streams the current unsigned Apple silicon DMG from the
  private R2 bucket binding `OPENMELD_DESKTOP_DOWNLOADS`.
- `/desktop/update.json` returns the Desktop app update-awareness manifest.

The page must make the preview contract explicit:

- the build is macOS Apple silicon only;
- the build is unsigned and not notarized;
- Node.js LTS with npm is required for this preview;
- Desktop will install or upgrade the global OpenMeld CLI when Node/npm is present;
- users may need to approve the first launch in macOS Privacy & Security or by
  Control-clicking the app and choosing Open.

Web must not claim setup success because the app was downloaded. The successful
first-round path is: user opens OpenMeld Desktop, Desktop drives CLI/service setup,
OpenMeld Web Spaces can create a Space and Profiles, and a local agent can be woken
through the local OpenMeld Service.

### OpenMeld Agent Interface

`/agent-interface` is the browser entry for Agent-led OpenMeld setup. It must remain
an entry point and handoff surface, not a new setup authority.

The page may be visible before sign-in. The Agent-readable public contract at
`/SKILL.md` must be public and must not require authentication. The older
`/agent-interface/guide.md` path is a compatibility entry to the same public
contract, not a second source of truth. Private setup access belongs only in the
generated prompt, where Web mints a Prepare Session token and approves a Device
Authorization grant for the signed-in user. The grant creates a separate
Computer session; it never transfers or reuses the browser session.

The generated setup command should prefer Agent View and terminal-owned local
agent selection:

```text
<setup bootstrap> setup --start-session <opaque-token> --local-agents all --device-code <browser-approved-code> --view agent
```

This lets the user's current AI agent run setup without requiring the user to
choose local agents in Web. Web still does not decide whether setup succeeded;
it only creates the handoff and displays the prompt.

### Public Agent Manual

`/guide.md` is the public Markdown manual for agent behavior after Wake delivery;
`/llms.txt` points agents to that canonical URL. It is distinct from the
Agent-led setup contract at `/SKILL.md` and its compatibility route. The manual
must use current public CLI commands and current Space semantics. It must not
describe a shipped command as unavailable, teach internal endpoints, or become
a second owner for setup, Space, or execution truth.

Production Agent Interface setup starts from the Web-generated bootstrap.
On supported macOS production setup defaults to the binary distribution: the
bootstrap downloads the gzip transport declared by the CLI binary manifest,
shows its real rounded download size, verifies the archive, decompresses it,
verifies the final executable, runs `install-self`, and then runs setup through
the managed binary path. Before downloading an artifact, it compares the
existing lane-managed executable's exact byte size and sha256 with the manifest;
an exact match is reused, while any missing or mismatched executable follows the
normal verified download and repair path. Manifest and artifact downloads retry
temporary transfer failures within a small bounded window, deleting partial
output before each retry; integrity verification still decides whether the
download is accepted. A legacy manifest without archive fields still uses the
verified raw executable. Windows and explicit `?dist=npm` setup use the npm
distribution. The bootstrap is only the
setup entry, not necessarily the long-term command prefix. The final
`setup.complete` event is the owner for follow-up commands:

- binary setup should report the managed binary path, such as
  `$HOME/.openmeld/bin/openmeld`;
- npm setup may report `npx -y openmeld@latest` when it is the explicit
  distribution or fallback;
- Web prompts must tell agents to use the final `setup.complete` prefix, not to
  infer the production lane from the command originally shown on the page.

The Agent Interface prompt and public Skill must not hard-code the follow-up
CLI entry as `openmeld`. Setup is lane-scoped. The generated prompt and final
bootstrap output must tell the agent the exact CLI command prefix for follow-up
commands, such as `openmeld-dev` for local development or
`$HOME/.openmeld/bin/openmeld` for production binary setup. The prompt may show
`npx -y openmeld@latest` only for Windows, explicit `?dist=npm`, or npm recovery.
The agent must use the final prefix for `whoami`, service diagnostics, and later
Space operations instead of guessing a lane.

The public Skill must explain that first setup on supported macOS normally
downloads and installs the managed binary. It should tell agents to complete
local CLI setup and then use the exact `setup.complete.cliCommandPrefix` for
ordinary OpenMeld work. That gives agents a stable local entry and lets
dispatch-owned Wake runtimes expose per-dispatch Space Action shims. Inside a
Space Wake, agents must use the Space Action command printed in the dispatch
prompt; Web docs must not teach agents to rewrite dispatch actions to `npx`.

The public Skill should explain OpenMeld identity choices in setup language:

- the default human profile is automatically created for the signed-in user and
  is the right identity when an agent is operating OpenMeld on the user's behalf
- Account Setup Studio is the first-touch product surface for an incomplete
  account; after completion, the personal Center Agent DM remains an ordinary
  conversation home
- setup does not create a separate welcoming Agent Profile or welcoming Space
- a manual Agent Profile may be unbound and still useful when the agent is
  manually representing an AI teammate from the CLI
- a wakeable local Agent Profile must be bound to local agent execution before
  the Space can wake it automatically

Web setup, Computers, and Profiles surfaces should use the
shared Local Components action vocabulary for local recovery CTAs. Service comes
before local-agent binding: when OpenMeld Service is missing or disconnected, show
`Connect OpenMeld Service` or `Reconnect OpenMeld Service`; when the service bundle or
runtime contract is out of date, show `Update OpenMeld Service`; only after the
service layer is usable should an Agent Profile binding problem show
`Connect local agent`.

On the Computers local agents card, the `Connect local agent` notice
is reserved for the zero-agent case: this computer reports no usable local
agent rows. When the catalog reports usable rows — including a partially ready
target where individual agents carry issues — per-agent guidance belongs on
those rows (status text plus enable or repair affordances), and the card must
not hoist a generic connect banner above agents that are already reported
healthy on this computer.

For the signed-in member's own computers, each local-agent row should identify
the exact provider account when ACI reports a reliable email. The email is
blurred by default and becomes readable only after the user activates it; the
summary and expanded detail share one reveal state. A reliable non-email label,
such as a connected-provider count, may remain visible. Web must omit the
account identifier when the controller cannot prove one and must never infer it
from credentials or unrelated app state. This evidence remains absent from
another member's read-only Computer view together with the rest of the local
agent inventory.

An incomplete controller check is retryable warning evidence, not proof of
repair. Web must show `Checking` only while an actual local-agent check request
is running; it must not manufacture a checking state from an unrelated
readiness fetch or a fixed grace timer. Computers, Agents, and Space recovery
surfaces must consume the Core-owned current-local-runtime `nextAction` for the
completed outcome. A completed `check_status` verdict uses the same amber
**Couldn't check** outcome on the affected local-agent row, the current Computer
summary, and current-Computer toolbar attention. It never becomes a red repair
alert or setup action.

Web does not inspect a second execution-target snapshot to override the Core
verdict. Core excludes disabled local agents from Computer status, aggregate
reason codes, and recovery actions. Web keeps an all-disabled Computer neutral,
with no navigation attention, while the disabled rows and their diagnostic
details remain available. Raw reason codes remain diagnostic evidence; Web must
not maintain a reason-code allowlist that independently decides whether setup,
retry, or attention is required.

Computers may let the user turn an already reported local agent on or
off, but Web is only the intent surface. The write must go through Core to the
current live Local OpenMeld Service, and that service must update the local registry
through its existing single writer. Web must disable the control when Core does
not report current-service support, and it must surface failure instead of
optimistically treating local agent enablement as changed.

Computers may show local controller update advisory from the shared
ACI read model. Web may render a status badge, detail row, and manual update
command guidance, but it must not run Codex, Claude Code, npm, Homebrew, or any
other local controller upgrade command from the browser.

Agent Profile create and edit compare each catalog model with the selected
Computer's reported Local Agent inventory. A model that the current inventory
explicitly excludes is disabled with a plain explanation and an **Update or
change {Local Agent}** link to that exact Computer. A valid catalog version floor
may provide the same guard when inventory is unavailable. Missing, failed, or
unrecognized evidence does not disable a model. Existing incompatible selections
remain visible until the user chooses another model or changes the installation.
When a Wake proves that the selected Local Agent cannot use the model, the
failure action opens Computers directly instead of sending the user through
generic setup or diagnostics first.

Web must not maintain a second update-status source. Computers, Agent
Profiles, the Space member panel, Space Wake banner, and Web setup handoff all
read the Core local component update projection or a Core readiness result
derived from it. If that projection says OpenMeld Service needs a required update,
Service-specific Web surfaces should use the same primary action:

```text
Update OpenMeld Service
```

The Computer detail **OpenMeld Tools** card is the aggregate local-component
surface. It shows Service, CLI, and skill status as equal read-only details and
must expose at most one recommended action. When one or more of those components
has an actionable update, the card-level action is:

```text
Update OpenMeld Tools
```

When the current Service advertises OpenMeld Tools control, **Update** sends one
owner-scoped request to the Service's background coordinator. A quiet **Update
manually** link remains immediately beside it and opens the deterministic CLI
setup path. The user may close the page immediately and never needs to copy a
command unless they choose that fallback. This direct action remains available
when automatic updates are off. The same managed action also owns CLI-only
updates; Web must not fall back to a command dialog when the installed Service
can safely ask the coordinator to update OpenMeld Tools. An older Service that
does not report managed update capability shows only **Update manually**; Web
must never offer an action that the installed Service cannot perform. The same
card shows one capability-gated **Keep OpenMeld Tools up to date** switch and
reads its value from the Service-owned maintenance projection. It never keeps a
browser preference. Required-update copy and the primary action name the
current installable Service release supplied by Core; Web must not expose an
older internal compatibility floor as though it were the user's upgrade
destination.

The card renders the canonical operation phase as one short status:
**Finishing current work**, **Updating**, **Verifying update**, **Up to date**,
or **Update failed. Try again.** Clicking **Update** changes the action to
**Updating** immediately, then retains the Service-returned operation and polls
the same Computer projection. Operation updates with the same id are monotonic:
an older `updatedAt` snapshot, or an equal-time snapshot from an earlier phase,
must not move the visible operation backward. `updated` means only that the
installation operation ended; Web continues to show **Verifying update** and
polls until both the Service and CLI projections reach that exact operation
target. A newer release becoming available does not reopen or hold the previous
operation in verification; it becomes a separate actionable update. A stale
refetch must not erase the local accepted-operation evidence, and a
`current` control response must not produce **Up to date** until the component
projection agrees. Request completion and installation completion are not
verified update completion. Service connection recovery remains explicitly
**Connect OpenMeld Service** or **Reconnect manually**. When Service is offline,
both the card action and its More menu use **Reconnect manually** and open the
existing Connect/CLI path; Web never pretends it can send a managed reconnect
through the disconnected Service.

This verification contract survives a reload or a new tab: browser-local
request state may improve the immediate click response, but it never decides
completion. Web derives **Verifying update** from the authoritative operation
target and the exact installed Service and CLI projections. It keeps reading
through a short Service replacement, resets its bounded verification budget
only when the owner operation reports newer progress, and stops polling after a
bounded period of no convergence or repeated refresh failures. That exhausted
state says **Couldn't verify the update. Try again or update manually.**, keeps
the managed action retryable, and always preserves **Update manually**. It does
not require the user to refresh the page and does not turn missing evidence into
success or failure of the underlying installation.

For an `update_service` setup run, terminal completion proves only that the CLI
flow ended. Web must keep the result in a bounded confirming state until both
the CLI and Service projections arrive and neither still requires an update.
Missing projection data is not success. If the bounded verification window
expires, Web shows an explicit OpenMeld release-side failure instead of a false
completion checkmark or an endless spinner.

The human-facing command is the Web-generated setup command. On supported macOS
it defaults to binary setup. For Windows, explicit `?dist=npm`, or npm recovery,
the package-based command is:

```text
npm install -g openmeld@latest && openmeld setup
```

Do not append `--view agent` in human Web setup copy. For npm distribution,
Agent-led setup prompts may use:

```text
npm install -g openmeld@latest && openmeld setup --view agent
```

Use `npx -y openmeld@latest setup` only for npm bootstrap or fallback when the
global `openmeld` command is not installed yet.

These labels may all route back into the setup flow, but each user-visible
scenario should expose one primary action and one primary entrypoint. Web should
not make users choose between `openmeld setup`, `openmeld service repair`, `openmeld service
update`, and skills commands.

## Wake Availability And Recovery Presentation

Web may display Wake availability on Agent Profile and Space surfaces, but it
does not own execution truth.

Final user-facing Wake availability must come from Core-owned Agent execution
status. Web must not reconstruct it from local browser state, Space membership,
Binding existence, route-online evidence, service health, setup completion, or
capability inventory.

Web may briefly refresh local owner diagnostics when Core reports checking or
self-healing evidence, but that refresh behavior must have an explicit
expiration boundary. After the refresh window or attempt budget is exhausted,
Web must stop presenting transient checking as the public state and must return
to the latest Core-owned Wake availability or owner recovery guidance. It must
not keep a last-known `Available for Wake` badge when the current Core
projection says the route, service, or execution path is no longer available.

The Space Members surface may use Core/Space active Wake progress read models to
show that a target Agent Profile is actively running or waiting for OpenMeld Service,
even when the latest member availability row is stale or degraded. That overlay
is presentation-only evidence for one active Wake. It must not become final Wake
availability, recovery eligibility, Binding truth, member sorting, mention
authoring, or Profile Details truth.

Visual smoothing for brief `checking_connection` flicker may replay the last
`Available for Wake` presentation only for the compact row indicator and its
accessible label, and only inside a bounded debounce window. Terminal
`offline_for_wake` or `unavailable_for_wake`, cold-start checking, recovery
actions, diagnostics, Profile Details, sorting, and command eligibility must
continue to read the raw Core/Space snapshot.

The Space Members surface presents an Agent Profile's availability as a compact
status indicator immediately after the profile name instead of repeating the
status as visible text. The indicator keeps the public status as its accessible
name and preserves the current explanation in its tooltip. Available is green,
Checking is blue, Unavailable and other actionable attention states are amber,
and Offline is muted gray. Offline and Unavailable profiles also use a muted
name; Available and Checking names retain the normal foreground. If the former
status text linked to a recovery surface, the indicator remains that link and
keeps a visible keyboard focus state. The primary detail row still carries the
plain-language explanation and next action where applicable. Do not introduce a
red indicator until the owning readiness contract exposes a distinct failure
severity that warrants it.

Reply recovery copy may be shared through Agent Profile recovery semantics. Web
adapts browser-local and current-local-runtime evidence into that shared copy,
then presents one clear next action. The copy explains known evidence and the
next step. It does not decide execution truth.

When a Wake failure maps to a local-service recovery action, Web may show a
local repair entry only when the failed target is manageable by the current
user. For another user's computer, Web should explain who needs to check OpenMeld
Service and the local agent instead of linking the current user to a repair
surface that cannot fix that target.

When evidence is incomplete or degraded, Web should keep the user-facing message
simple:

```text
current outcome
one next action
available diagnostic link or report entry
```

Do not expose internal subsystem names as the primary user experience.

## Owner Boundaries

Use the scoped owner documents for deeper rules:

- `developing/product/product-model.md`: product promise and top-level model.
- `developing/product/space-collaboration.md`: Space addressing, Wake,
  Reference, thread placement, and final visible outcome semantics.
- `developing/product/agent-profiles.md`: Agent Profile identity, membership,
  Binding surface, and reply recovery semantics.
- `developing/product/center-agent-routines.md`: Routine and Run semantics,
  authority, scheduling, and result surfaces.
- `developing/product/center-agent-tasks.md`: Task product semantics, context,
  access, concurrency, cross-channel continuity, recovery, Inbox, board/detail,
  and compact-window behavior.
- `developing/architecture/agent-transport-contract.md`: readiness, Wake
  execution, RuntimeCoordinator authority, and final outcome contract.
- `developing/architecture/local-openmeld-service.md`: local OpenMeld Service, account,
  device, lane, Prepare, update, and trust-boundary rules.
- `developing/architecture/data-and-observability.md`: trace selectors,
  waterfall read models, Diagnostic Reports, and sensitive-data boundaries.
- `developing/architecture/shared-contracts.md`: shared schemas, shared runtime
  policy, shared Agent Profile recovery, and password normalization.

## Product Invariants

- Web is the main browser collaboration surface, not execution authority.
- Web renders Space facts; it does not own Space truth.
- Web presents Agent Profile identity; it does not own Agent Profile truth.
- Web setup handoff is an entry point; it is not local OpenMeld Service truth.
- Routine permissions and eligible targets come from Core-owned projections;
  browser caches and optimistic mutations are not authority.
- Every Web-authored Wake must preserve a non-empty `clientMessageId`.
- Per-target Wake details must include the target Agent Profile in the query key
  once known.
- Protected Space passwords and secrets must never enter query keys or browser
  diagnostic pointers.
- Wake details and waterfalls are read models, not writers or authorities.
- Active Wake progress must rehydrate from Core/Space read models after refresh;
  browser-local state is not progress truth.
- Diagnostic Reports contain minimal user-submitted input; Core derives
  pointers.
- Thread placement is conversation placement, not execution truth.
- Reply staleness markers consume server-authored signal context; Web does not
  derive them from browser state.
- Conversation compaction markers consume the durable server-authored final
  Signal checkpoint; Web does not infer or animate compaction.
- Final Wake availability must come from Core-owned Agent execution status.
- A visible Wake problem should end with a clear outcome, one next action, and a
  diagnostic path, not internal subsystem vocabulary.
