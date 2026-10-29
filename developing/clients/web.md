# Web Client

## Agent Context

- Purpose: Define the OpenMeld Web client's product responsibilities in
  navigation, Projects presentation, Space collaboration, hosted reply
  streaming, Center Agent memory controls, Wake authoring, thread presentation,
  Center Agent sessions and compact window, setup handoff, Wakeability
  display, Wake diagnostics, and browser-side diagnostic pointers.
- Read this when: You are changing OpenMeld Web navigation, Settings placement,
  Project routes or current-computer presentation, Space flows, Wake authoring,
  thread UI, reply context, hosted reply streaming, the public agent manual,
  Center Agent memory settings, Wake details, Diagnostic Reports, setup handoff
  entry, Wakeability presentation, Agent Profile surfaces, or Web
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

## App and public website boundary

After a timed-out Check agents request, the Local agents card reconciles the
original account scope, device and lane. Every controller present at request
time must have a newer native observation before the card reports refreshed
status. One early controller result cannot complete the group. A refreshed
projection is not an operation receipt: only the original successful control
response reports that the check completed. An unknown or partial result keeps
the still-checking guidance.

On the owner's Local agents card, each agent shows one status from one rule.
Launch facts come only from the Core catalog entry, and controller facts only
from the Agent Controller Interface snapshot. A completed negative launch result shows
`Choose installation` or `Can't start`; a check that is late, expired, or did
not finish shows a neutral `Check delayed` and keeps the last known details;
sign-in and controller health follow. The interface snapshot never decides
`Can't start` on its own.

Message details offers **Hand off** to continue work from its current readable
message with another Agent. The current form requires a Project/repository and
published commit only when **Include a repository** is selected. By default it
hands off a brief and optional shared-file revisions with no repository. Local
receivers use an isolated Space-only Context. The receiver list follows the
shared material-support policy; selected files without a repository require
Codex or a Remote Agent. Repository fields load only when selected, start a new
independent copy at a complete published commit, and keep extra access
restrictions a separate choice.
The Web always selects an isolated repository copy. Current-folder repository
handoffs are available only through an explicit CLI manifest.
The source result prepopulates the brief; shared file revisions are unchecked
until selected. A send retry freezes the same input and client message ID.
Background source refetches, reconnects, and refresh errors preserve the mounted
draft and frozen request. A new source revision requires explicit review before
a first submission; an uncertain submission keeps its original revision, payload,
and request identity for retry even if the source changes.
Publication success is displayed as requested; existing message/Wake projections
own execution and final delivery. A thread handoff retains that exact thread;
a root message can also be handed off within its own thread. Project/repository
fields are shared with the composer rather than opening a second modal over
the Message details drawer.

`clients/web` is the App at `app.openmeld.ai` (Staging:
`app.staging.openmeld.ai`). Its root enters the authenticated Organization
resolver or sends anonymous visitors to `/login`. Public marketing, legal pages,
and Changelog belong to `clients/website`; local-agent guides belong to `clients/docs`
with legacy Website URL redirects. Web keeps only
redirects for those pages. See [Public Website](website.md) for presentation and
root-domain forwarding. Web remains the sole owner of Auth proxies, application
APIs, installers, downloads, and native authorization entry points.

## Conversational Plugin setup

A Plugin setup intent opens the current Organization's existing connection
surface in a Fluid dialog without replacing the conversation route. Hosted
publication appends a normal Markdown link; the new `plugin_connection` union
member is not published into the callback or stored message envelope. Older
readers retain a usable link. Current Web/packaged Desktop readers enhance only
an exact final-reply suffix on the trusted app origin and current Organization,
without rewriting stored text. Provider authorization, credentials, current
status and Agent access remain in their existing owners.

Plugins, Onboarding and conversation setup share `PluginConnectionSurface`.
It selects the existing GitHub adapter or generic App adapter; it does not
implement another authorization state machine. GitHub user authorization and
Organization installation remain distinct, as do OAuth and secure credential
forms for other supported providers.

The dialog reads the signed-in viewer and current connection options only when
opened. An explicit personal/shared scope or server-frozen choice wins.
Unspecified setup reuses a single existing connection, but when both identities
exist it asks which to use instead of silently preferring personal. Members may
choose an existing shared connection without receiving its management rights;
Core still checks its actual Agent access. With no connection, ordinary members
get personal setup and eligible owners/admins can choose. Personal Workspaces
omit this team choice. A choice does not connect or run anything; explicit
Continue submits that scope and Core freezes the exact authorized account.
Connection refreshes and transport retries must not silently change it. The
server rechecks every mutation. Once an active connection is present, the
existing Agent access editor is visible directly below its form, shared by
Plugins, Onboarding and the conversation dialog. New registrations show no Agent
access; only an explicit Save access action changes permissions. Historical
connection policies are preserved, not silently reset. Opening historical
messages does not query access before the user opens setup.

Access queries use the current viewer and connection authorization snapshot,
filter to that viewer's personal and the selected shared registration, and
refresh all scoped editor views after a save. Reauthorization and revision
changes discard stale permission drafts. The conversation Continue control is
disabled while permissions are unavailable, all consumers are denied, or edits
remain unsaved. Enabling it is not an execution grant: Core still checks the
original Agent's specific consumer permission and each action's effect. Shared
read-only viewers retain the Continue control outside the management fieldset;
only an owner/admin may change shared policy. A save never resumes work.

Closing the dialog keeps the conversation in place and unmounts the existing
authorization view. A disconnected, expired or provider-denied connection is
not evidence that a task completed. External providers still require their own
consent/approval. An explicit **Continue original task** button calls the
Core-owned continuation endpoint with only the original reply, service and
selected scope. Core verifies the original human, delivered reply, current
membership and Plugin access; it submits one idempotent Message/Wake in the
original conversation and Thread. It includes bounded existing operation
receipts and refuses pending/unknown outcomes. Provider callbacks never trigger
work. The UI reports "requested", not "completed". Existing execution and
operation owners still determine the actual result.

Local Agent final replies use the same suffix and dialog. Their continuation
is admitted against the RuntimeCoordinator's published reply and current Local
Binding, not a Hosted delivery or a guessed completion status. A shared message
never authorizes its viewer to continue another person's task.

Slack, Feishu and Lark deliver Plugin setup privately through the existing
provider navigation publisher. The trusted Plugin detail URL may carry a
`request` locator. `PluginConnectionRequestPanel` first asks Core to verify the
signed-in requester, Organization and original provider task, then reuses
`PluginConnectionSetupPanel` and the existing connection/Agent-access forms.
The URL cannot choose a target Agent, task body, user, connection or permissions.
The shared explicit Continue button sends only the request locator and scope;
the existing provider native-delivery owner resumes in the original conversation.
Preview, mounting, account setup and OAuth completion do not execute work. An
unverified, expired or mismatched request shows an error instead of an unbound
fallback. The read-only preview cache is keyed by Organization/user/request and
is discarded on unmount. Older clients still see a normal setup page/link; they
must not be counted as supporting the new continuation interaction.

Independent authenticated browser/installed Desktop acceptance remains in
`design-plans/1254-composable-plugin-workflow.md`; component tests are not that
acceptance.

## Space creation feedback

The account Space query uses one `reconcileAccountSpaceSections` owner for
accepted Create/Join receipts, accepted message previews, and pending Pin
choices. Sidebar and Browse render that same query. Receipts bridge a stale
index read, clear when its projection catches up, and are not persisted as
membership authority. Recent activity includes creation and joining even when
a Space has no messages. Discover excludes current account memberships.

Leave removes the visible entry and navigates away before requesting membership
revocation. Success clears the departed conversation's read cache; it does not
refetch the now inaccessible Space. Failure restores only that entry and shows
the server's error. Other pending entries remain intact.

Create opens the conversation immediately with the submitted name, shared Space
header and tabs, and the normal editable composer. A small `Preparing…` notice
is centered in the empty message area using shared `TextShimmer`, with static
text for reduced motion; there is no separate waiting page. The sidebar reads
the same Organization/Profile-scoped mutation receipt.

The temporary `creating-` route identifies a browser-local creation request,
never a server Space or membership. It must not issue Space reads, uploads,
searches, presence, or read receipts. The verified create response replaces it
with the canonical Space route without adding a history entry. Directory
refresh runs independently and cannot delay entry.

The creation conversation owns only the preparation phase. Once the create
response, bootstrap, and member admission are confirmed and the route names the
confirmed Space instead of the `creating-` id, the tab that created the Space
renders the regular Space route's validated entry layer, the same one
a fresh tab uses: account Profiles, the active-Human check and its redirect or
chooser, entry resolution, focus targets, and Organization context. A
notification or deep link into the same Space therefore lands on its target.
The handoff adds only what that tab alone has: the composer draft migration
scopes, the staged message and its consumption, the chosen tab, and composer
focus restore. The switch is one-way; a later read failure or retired receipt
does not return to preparation or remount the conversation. The regular route
never renders with a `creating-` id, so it cannot read that id as a Space or
migrate the creation draft onto itself; if the replace navigation has not
landed or failed, preparation stays and offers `Open Space`. If the acting
Profile is no longer an active Human when the regular route redirects to
another Human, the handoff does not follow: the draft and staged message stay
under the creating Profile's scope and are never sent as a different identity.

Text and attachments use the existing composer draft owners. Sending during
preparation stages one message with a stable client message ID. The regular
Space composer publishes it only after bootstrap confirms access; creation
never publishes a message itself. Draft and attachment scopes migrate to the
canonical Space when ready. Creation failure stays in the conversation with
the draft intact and guidance to check Spaces before another attempt. It never
retries creation automatically. Leaving the page prevents completion from
navigating away from the person's chosen destination.

Multi-selection in New Message uses the same creation owner. Bootstrap starts
as soon as the create response arrives, in parallel with member admission.
Full member readiness reads start after admission instead of waiting for the
conversation to mount. A staged message waits for confirmed admission; failed
admission can be retried in the same Space without repeating creation.

Agent creation receipts return confirmed identities to the shared picker without
waiting for directory refresh. They expire when the directory includes the Agent
and never imply membership or availability. Existing-Space additions close the
picker immediately and show presentation-only `Adding…` rows. Only the server
response changes membership; failure removes pending rows and offers retry.

Completed Agent creation refreshes the Organization Profile Directory. Before
automatically opening its Direct Message, the route shares that confirmed
directory with the sidebar identity reader, so the first conversation render
uses the current model avatar. Creation receipts do not define avatar identity,
membership, or availability. Leaving the creation route still prevents automatic
navigation when the reads finish.

## Selected Space work

Team → Files contains Team files, member-private My files, and Knowledge. Knowledge
opens the existing approved-content and draft-review workflow inside the Files
entry; old Documents list, detail, and creation links redirect into Files while
preserving their target and selection. This navigation step
does not make an ordinary Markdown file approved knowledge or add a second
content writer.

Space Files shows chat attachments and manually uploaded files together. Its
toolbar contains file operations, not the structured work-handoff form. The
shared API and CLI handoff contract remain available for explicit work handoffs;
this presentation change does not change their permissions or execution flow.

## Boundary

The account avatar's top-level **Download Desktop** item appears only on Web and
opens the website's public `/downloads` page. Its Web metadata projection, the default DMG route, legacy update
JSON and macOS updater feed read the single promoted Desktop release in R2.
Explicit candidate selectors remain strict and never fall back to the promoted
release. Desktop's shared renderer exposes Updates through its native bridge;
browser Web has no updater controls.

### Shared Profile and Organization actions

The Team Agent directory and person Agent directory default to Fluid group cards by local
Controller and remote model provider. Group disclosure is local presentation
state; it does not mutate the page or section filters. Filtering precedes grouping,
and the current sort determines the Agents and first three avatar previews within
each card. A borderless two-by-two preview shows up to three avatars and the
remaining count. The section's Expand all control hides group holders and restores
the original flat Agent cards without changing filters or sorting; Show groups
restores grouping. Existing view settings also offer Controller, Provider, Model, and
ungrouped presentation. Bulk selection shows all filtered cards so its visible
selection scope remains explicit. Center Agent presentation stays separate.

Web and the packaged Desktop renderer use the same fixed `/v1/` business routes.
`lib/auth-business.server.ts` validates public inputs and safe response projections
while retaining Auth's original HTTP handlers, permissions, middleware, cookies,
and mutation effects. Organization settings endpoints accept only name/slug,
member admin/member roles, and the existing invitation operations. They expose no
vendor session object or caller-selected upstream route. Invitation URLs remain
legitimate permission-checked domain results.

Agent removal uses `DELETE /v1/profiles/agents/:profileId`: Auth checks owner and
Agent kind before deleting through its existing owner service. Generic Auth/RPC
Profile deletion retains its existing consumers and semantics. Auth owns deletion
reconciliation; Web retains warning-only catalog refresh on success or 404 and
the shared UI retains optimistic rollback/invalidation. Profile creation remains
a durable commit before local setup. No new Organization active-session writer
or membership store is introduced.

### Center Agent selected sessions (Flue 2 candidate)

The Center Agent chat at `/o/{orgSlug}/chats/center-agent` accepts `?session=<space-id>`. This selects an exact
private Center Agent conversation through Core's session projection endpoint;
the route does not reuse the default conversation cache or call the default
open operation when the selected session is unavailable. A malformed selected
session fails rather than dropping the selector. Invalid unrelated legacy
search fields may be discarded while retaining a valid session selector.

The selected session participates in loader dependencies, query keys and
component identity. Both server-rendered reads and client reads forward it.
View changes and retry retain it. Pending-route composers, queued first
messages and pending drafts use the session scope, then migrate only that
draft into the canonical Space composer. Switching sessions in one Organization
preserves separate pending messages; organization switching retains the
existing cleanup policy. A cache key or URL never grants message/file access.

The unselected Center Agent chat is an entry point, not a separate permanent session
identity. It retains the existing pair-based open/reuse behavior. Once a
conversation is displayed, view navigation pins its resolved Space ID in the
URL so Files/Messages cannot reselect a different conversation. Explicit
session links always select their exact identity, including after reload.

The resolved conversation's component identity uses its canonical Space ID.
Pinning that same ID into the URL must not remount the conversation and discard
an attachment-open request. Opening a final-message attachment therefore retains
its selected file revision while switching from Messages to Files.

Web uses three navigation levels: a 64px application rail (52px in Icons only), a contextual
list inside the inset surface, and the current work area. **Inbox / Spaces /
Team / Routines** are the rail's primary destinations, in that order. Hovering Spaces offers
Direct messages and Discover, using the existing Spaces view parameter. Both
can be pinned; Direct messages appears as DMs in the rail. Personal workspaces
hide Discover in the popover and pinned list. Hovering Team (or pressing
Arrow Down/Space on it) offers Agents, Files, Skills, and Plugins
with separate pin toggles. Routines is always a primary destination; old saved
Routine pins are ignored so it never appears twice. A divider separates the creation shortcuts: Spaces
offers New message and New Space; Team offers New Agent. These actions cannot be
pinned. New message shares the rail-owned dialog with command search; New Space
and New Agent use the existing Organization creation routes.
Clicking Team still opens People. Pinned shortcuts appear below a short divider and
persist in the browser; links always target the current Organization. A pinned
current page selects its shortcut instead of also selecting Team. Icon tooltips
open immediately. Desk is temporarily hidden
from navigation and remains accessible at `/o/{orgSlug}/desk`. Organization
switching remains at the top; the global Create entry is temporarily hidden.
Creation is also available in the Spaces and Team contextual headers. Global search
and Settings are available in the footer account menu. Search has its own section
and the shared Command K keycaps. Inbox
retains the shared attention badge and active-route treatment. In the compact
rail, hover and active backgrounds surround the icon and its attention marker;
labels stay outside that background. The Organization avatar fills its 36px
shape-aware trigger. Account, theme, and Settings remain reachable
from the account menu. Its 32px avatar trigger retains its left and bottom inset.
Separate Fluid hover groups own account identity, Search, actions, and sign-out.
A compact Light/Dark/System selector follows Download Desktop App without a divider and keeps the menu
open when changed. Settings > Appearance uses three full-size theme cards with
labels and descriptions. Both controls share the theme choices and icon set;
the existing theme provider owns persistence and system appearance. Spaces and its contextual sidebar heading always open
`/o/{orgSlug}/spaces`. This home displays the shared conversation list, with
Spaces, Direct Messages, and Agent conversations interleaved in the default
Recent view. Existing explicit Grouped, pin-layout, and preview preferences
remain honored. The home list is primary content: it remains visible even if
the contextual sidebar was hidden, and fills narrow screens rather than being
placed behind a drawer. Wide screens show a selection prompt beside it; opening
a row uses its canonical conversation route and the existing contextual list.
Home search is visible without opening a menu and does not autofocus. The
New conversation menu and wide-screen selection prompt expose Browse Spaces
at `?view=spaces`. The directory retains Your Spaces, Direct messages, and
Discover, with a leading Chats tab returning home. Discover is absent in
personal workspaces. Home does not gate its list on the Organization Space
directory query; it uses the existing authorized conversation read model.

Your Spaces, Direct messages, and Discover default to Cards and offer Table in the directory toolbar.
The tab body and navigation read the same immediate URL state, so switching
panels does not wait for route loaders to commit the search parameter.
All three tabs retain the same Space shell and sidebar. Switching the directory
panel does not remount sidebar avatars, subscriptions, or resize controls.
The sidebar's View and filters menu includes Show message previews. It defaults
to on and persists per Human Profile and Organization in the browser preference
store. One setting controls the sidebar and both directory card views; it does
not change Table previews or suppress actionable needs-input status. Hidden or
absent message previews reserve no sidebar line or card footer. Single-line
sidebar rows center their icon, title, and actions, and title tooltips anchor
to the full row's trailing edge rather than the avatar.
Both presentations consume the same saved sections, ordering, filters,
membership previews, unread destinations, and current work indicators. Cards
use eight 40px member slots, reducing to six, four or two on narrow cards. The avatar
area reserves two rows, and cards stretch to equal height within each grid row.
Overflow occupies the final slot; at least one avatar remains. The title truncates
before its unread count; the title, lock, and count share one vertical center.
Cards omit activity timestamps and show only the latest message
as plain text, with its message link and full-text
hover previews. Empty conversations have no preview footer. The opt-in directory
projection reads eight members and two message previews from the authorized account
index, with no per-card Space history fan-out. Member previews and action menus
keep independent targets.
Card member previews open only over an avatar or the overflow count. Gaps and
unused avatar slots remain part of the Space navigation target. The member
popover also has a primary Open Space link in its header; keyboard activation
of the member trigger remains available.
The existing browser preference store remembers this choice per Human Profile
and Organization, shared across all three tabs. Direct message
cards keep peer and Center Agent session identity, unread destinations, groups,
pinning, and archive actions. Their 56px peer avatar has no reserved multi-member
grid height; the title follows directly, with one latest-message preview row
only when messages exist. Discover cards and rows expose the same Preview and
Join actions, pending state, and access checks. Cards place the primary Join
action at the right of the member count in one row, separate from the card's
preview target. Responsive member grids mount
each avatar once; CSS changes visible slots without duplicating avatar drawing.
The App's read-only Discover preview omits the Agent-facing Space context
disclosure and structured JSON link. The standalone public reader retains them;
the existing presentation context owns this distinction without changing read
access or the context API.
The Agents directory uses the same store to remember grouped versus expanded
presentation per viewer, Organization, and person. Search and temporary filters
do not become saved layout preferences.

The Team contextual header has an Add menu with Invite members and New Agent.
It reuses the existing Organization invitation flow (absent in personal
workspaces) and Agent creation route. Its adjacent Filter people menu retains
connection, activity, and group filters. The compact search field uses the
same size as Spaces and says "Search people..." without a close action.
Direct messages uses `?view=messages`; the old `/chats` index redirects there.
Individual chat, profile, thread, and session links retain their existing routes.
The contextual heading has no aggregate attention dot; the rail and individual
conversation rows retain their canonical indicators.
Header actions move into one labeled overflow menu when the contextual list is
narrow, keeping the title and controls on one row. Both layouts share the same
creation, view, and filter menu contents.

Spaces, direct messages, and Center Agent conversations share the Spaces
list in the middle column. Team uses content-specific navigation: People owns
the member list; Agent detail shows the current Agent list, while the Agent
directory uses its existing cards and filters without a duplicate sidebar.
Files owns Team files, My files, and Trash navigation, with folders and
breadcrumbs in the file browser. Skills and Plugins use their catalog search
and filters without a member sidebar, including detail, loading, and error
states. Routines keeps Personal/Team scope and list controls in its page.
Settings retains its own settings navigation. A page without contextual
navigation does not create an empty middle column or load the Spaces list.
The contextual title holds the collapse control while the middle list is open;
when collapsed, list-page work-area headers show the expand control beside that
list's edge. Spaces uses this control in place of its decorative title icon,
and Team uses the same placement. Toggling does not hide the application rail or
remount the conversation. The existing Fluid sidebar engine owns resizing and
keyboard shortcuts. The middle column has only expanded and hidden states,
with a 200px minimum expanded width. Dragging below that minimum collapses it
directly; returning past a small drag deadband restores the expanded column.
Keyboard resizing uses the same bounds and skips the icon-only tier. Saved
narrow widths are clamped to the readable minimum before rendering. Row titles
remain single-line and use an ellipsis when space is limited. A 32px hover-intent
strip along the content edge reveals a floating preview.
The preview keeps the same title toggle, which restores the full column even on
detail pages without a work-area header. The existing outer-sidebar cookie
stores middle-column geometry on Web, with a 308px default. Desktop uses the
existing browser-preference local storage under the same stable keys because
its custom application scheme cannot save document cookies. An untouched
visibility preference follows the route: closed in the Spaces browser, open
in a Space. Explicit open/close choices override that default across pages and
reloads; resizing without changing visibility and collapsing groups preserve
the automatic rule. Legacy icon mode maps
to a collapsed list. Scroll positions are isolated by account, Organization,
and list family. Mobile presents application and contextual navigation in
mutually exclusive drawers; a collapsed desktop preference never hides the
mobile list. Recent is the default conversation view. Grouped offers a
shared Pinned section, existing personal groups, Spaces, and Direct messages.
Recent retains the same Pinned section and orders the remaining conversations
by the latest message, creation, or joining timestamp across both kinds. Both views use the same rows,
previews, identities, indicators, and canonical destinations. The view menu
changes only the sidebar; the open conversation, draft, and reading position
remain mounted. View choice is remembered in this browser per account and
Organization. It does not change another member's layout.

Conversation rows leave the preview blank when no message exists, preserving its
line height so titles and action controls stay aligned. Preview text
is quieter than the title: dark mode slightly reduces its muted color opacity;
light mode preserves readable preview contrast and slightly strengthens the
unselected title instead. Selection uses the row background without changing
title size or weight, including pinned tiles. Only unread titles use heavier type.

Pinned contains ordinary Spaces, human and Agent direct messages, and Center
Agent sessions once each. Its shared manual order uses the existing root
sidebar preference; ordinary pin membership remains Space Index-owned and
session pins remain in `chats` preferences. New pins appear first without changing
the existing pinned order, including entries hidden by filters. Dragging still
uses the chosen drop position. Unpin restores the saved group.
Pinned defaults to List, keeping previews and timestamps in the same compact
row layout as recent conversations. An explicit Grid choice remains supported:
48px avatars above two-line names, with two to four
columns targeting at least 76px per tile and 4px gaps. Additional rows use the
existing disclosure control. The Pinned header's Layout menu switches between
Grid and ordinary List rows without changing pin membership or manual order.
The browser preference store saves this choice per Human Profile and Organization.
Its settings action appears while the whole section is hovered or contains focus,
while the menu is open, and on touch devices. Grid hover bridges small gaps but
clears across empty last-row cells. List retains ordinary previews and timestamps.
Spaces, People, and Agents are optional filters. The plus menu offers New message
and New Space. The adjacent View and filters menu holds separate Conversation
view and Filter conversations submenus. The Spaces title remains the link to
the conversation home; Browse Spaces in the New conversation menu opens the
Your Spaces / Discover directory. Conversation detail and People hide their sidebar search fields by default. Search in the
header options menu reveals and focuses the field through the shared sidebar
search disclosure. The compact Spaces field says "Find a space..." and searches
existing conversations. In both sidebars, the trailing Close search icon and
Escape clear the query, hide the field, and return focus to the options trigger.
The input reserves trailing padding so long queries do not cover that control.
People options group computer filters in a
Computer status submenu alongside Search and Groups; there is no five-minute
activity filter. When no conversations match, Find someone opens the existing
organization-wide people and Agents picker with the search text prefilled.
The module sidebar header shares the work-area title row's vertical center.
Spaces, People, Agent details, and Files compose `AppModuleSidebarHeader` for
the same compact title row and collapse control. Product actions remain slots;
resize, collapse, and peek stay owned by the shared Fluid sidebar. Contextual
navigation inside a module sidebar uses `placement="module"` rather than nesting
an inner sidebar header and padding. Files keeps its current folder in the
`folder` search parameter so choosing a file location returns to its root.
Module content uses 8 px horizontal padding. Rows align their leading icon
centers 18 px from that content edge and their labels 36 px from it, matching
the header toggle and title. Row padding leaves room inside the shared hover
and selection backgrounds; do not remove it to compensate for outer spacing.
The header keeps the toggle's full hit target. Avatar sizes
remain appropriate to each surface; padding and gaps absorb the difference.
Navigation groups share a 4 px gap between the label box and the first row;
the label's own height and padding do not change to tighten this gap.
Team remains the member directory; there is no separate Contacts destination.
Spaces combines the canonical ordinary Space and chat unread aggregates
and retains chat action/urgent-update priority in its attention indicator.

Center Agent conversation titles open a searchable Fluid dropdown of the current
Organization's authorized private Center Agent sessions, including personally
archived chats. It reads every session-list page and uses Auth-owned personal
names before Space names. The shared Scroll Area bounds the menu height and
fades overflowing edges. The title's leading edge stays fixed. Its chevron follows
the title without an empty rename slot; hovering reveals the rename icon after
the chevron with a short opacity/transform transition. Keyboard focus and touch
also expose rename, and reduced motion disables the transition. Selecting
history navigates to the exact Space; a new draft omits the redundant New chat action.

The Spaces list shows the viewer's active private sessions with one Center
Agent as a single entry titled **{display name}’s Center Agent** (plain
**Center Agent** without a name); with sessions under more than one Center
Agent, each entry adds that agent's name. The name is the default Human Profile
name, which the Account display name keeps paired; renaming updates the session,
Profile, directory and Space member caches optimistically and, if the request
fails, rolls back only the name. The Center Agent is Organization-owned, so the
possessive names only the viewer's private sessions. The entry is the session it
opens: the one with the newest unread message, otherwise the most recently
active one, so its id, link and unread jump agree; it sorts by the latest
activity across its sessions. It sums unread, Wake count, Wake statuses, and
attention evidence across its sessions, and its activity indicator opens the
session that owns the shown work. A pin, group, or
manual position saved for any of its sessions applies to the entry; moving or
unpinning it drops the other sessions' saved positions. While a search is
active, each session is listed on its own row so a title match opens that
session.
Rename and archive stay on the session's title dropdown and header, not the
entry. Archived sessions keep their own rows in the Archived view. The session
title dropdown shows only the session title; the sidebar and Center Agent avatar
provide its identity. The title uses the available header width and truncates
before the actions. The heading's accessible name stays the session title. Other
lists that read conversations, such as the command center, keep one row per
session.

Selecting only Center Agent in New message, or **New chat** in an existing
Center Agent conversation's title dropdown, opens a local `?draft=new` composer without creating a session or
waiting for a session-list request. The first send creates the session and
hands its message to the existing Space composer. Creation identity survives
uncertain failures and same-tab reloads until navigation succeeds. Draft text
uses the account/Organization composer store. A `group` selector places the
new chat in that group if it still exists. Explicit draft and session selectors
cannot be combined. Existing-session loading and pending sends share one
conversation skeleton inside the inset app frame.

Space and direct-message pending routes retain the authorized conversation
sidebar and use the loaded conversation's header and centered content/composer
rails. They do not add an empty app header above the conversation header.
Loading shells reserve persisted Members panel geometry without reading protected
content or deciding membership. Loaded and loading Thread headers and the desktop
Members header reuse `SpaceInlineSidePanelHeader` at a fixed 56px height. Their
16px trailing inset matches `SpaceWindowHeader`, keeping the last Space action
and panel close buttons on the same vertical centerline.
A later product-driven panel opening remains a separate interaction. The
existing Space-open performance report also covers
Organization direct-message routes; Center Agent session routes are not Space
IDs and are excluded from that route matcher.

New-chat attachments use the shared Space file picker, paste/drop handling,
preview tray, and account-scoped browser draft storage. They remain local until
the first send creates a session; their original attachment and publication
identities then pass to the Space upload/retry pipeline. Session creation shows
the pending message immediately. Personal sidebar title/group persistence does
not block message handoff, including while the sidebar preference read is pending
or failed. Naming reads the latest real preferences and revision before saving;
its failure leaves the chat usable without retrying message creation. Leaving
during creation preserves the draft without
navigating back, and successful navigation only clears the draft version sent.
The draft, route-pending, and Space-bootstrap presentations retain the same
welcome content rail, conversation header, message primitives, and composer
height. Sending must not remove the welcome area and then restore it when the
canonical transcript arrives, shifting the first message between positions.
Loading existing chats reuse the same attachment controller. Route-pending file
drafts use account/Organization/session identity until the Space is known, then
migrate without changing attachment or publication IDs. Late draft saves and
queued sends remain observable by the ready route rather than being copied only
at mount.
Loading sends claim their message identity, text timestamp, and selected attachment
IDs at click time, before asynchronous file preparation. A queued submission is
not a composer draft: the ready conversation sends it independently, clears only
the submitted draft revision, and leaves newer text and attachments untouched.
Attachment restoration rejects IDs removed, cleared, or successfully consumed
in the same file session, even when an older storage read finishes later. The
admission rule is shared by restoration and explicit handoff; distinct late-saved
IDs remain eligible for adoption.
Attachment preparation reports validation, initial local persistence, remote
staging, staged-descriptor persistence, and publication failures separately.
Space, Thread, Center Agent pending/ready, and inline-edit composers expose the
same attachment retry and scoped cleanup recovery. Concurrent retry gestures
join one preparation task, and late upload results cannot restore a removed or
consumed attachment. A new Center Agent session is not created until its local
attachment handoff can be read; a failed handoff returns to the editable draft
instead of leaving the pending conversation locked.

Sidebar activity indicators resolve their destination from an authorized
active-Wake progress read on click, without adding per-row subscriptions.
Multiple runs use the displayed status priority and oldest start time. The
authorized Space bootstrap supplies reply placement: an explicit stream Thread
root opens that Thread, `null` means main conversation, and only unknown placement
uses the source Thread catalog. A Thread ID is never treated as a root message ID.
Message-preview links retain their separate exact-message semantics.
Center Agent session routes preserve the explicit Thread root through search
validation, page props, and conversation-view navigation to the Space owner.
Repeated selection scrolls again. If the
work has finished, the conversation opens with an explanatory notice; failed
reads retain an explicit retry path. Navigation does not change execution or
Stop authority.

Drafts and saved chats use the same header navigation and welcome template.
Management tabs retain the session or draft selector when navigating back.
Messages, Graph and Files remain scoped to that conversation; management tabs
remain Organization-scoped. A draft has empty Graph and Files views until sent.
The header pencil edits a personal chat title, including before the first send.
Draft titles persist alongside draft text. First send saves a manual title when
present; it never copies or truncates the message into a personal title. Space
generates the default title independently in the background, using the dedicated
small-model operation described in [Space Collaboration](../product/space-collaboration.md#center-agent-session-titles).
The pending/default name is **New chat**. Personal titles always override the
generated default, including renames during generation. Metadata invalidation
refreshes both the Space header and Center Agent session index.

The authorized session index supplies chat identities and paginated discovery.
Pages render progressively; title search covers all loaded pages while older
pages continue loading with visible progress. Personal titles, archive state,
pinning, groups and order live in the account/Organization sidebar preferences.
The same personal title is rendered in the conversation header. These preferences
are presentation only: archive hides a chat from the normal list, Unarchive returns
it, and neither changes membership, execution or history. Generic Space
management remains restricted; permanent deletion is not exposed.
Archived chats can be found through the Agents group settings or a chat group's
settings menu. Both controls share one filter state and the Archived badge.
The conversation header and Direct messages directory also expose Archive and
Unarchive for ordinary DMs and Center Agent sessions. These actions use the same
account preferences as the sidebar. The open conversation remains readable and
the success message explains where to recover it. In a DM header, Archive lives
inside the three-dot menu and opens a confirmation dialog before saving. Cancel
leaves the conversation unchanged. No shared-history deletion is involved.

Conversation message search uses the same bounded message-query owner as Agent
history reads. Its initial state also offers **Browse recent messages** within
one Space. Search previews include the matching portion of long messages; result
links keep the existing message/thread navigation. Inbox activity search retains
its existing endpoint and semantics. Empty partial or indexing pages continue
loading instead of showing a false no-results state.

The conversation header exposes message search as the same compact icon action
used by its neighboring tools, with an accessible label and tooltip. Its dialog
accepts a single character when scoped to the current Space, presents centered
dashed initial, no-result, and full-error states, and keeps workspace-wide and
Inbox search at a three-character minimum. One framed result region is retained
while empty or reporting a full error. Empty and full-error content is centered
with its recovery action. Real results keep the same region height without its
empty-state border or background; they remain top-aligned with normal padding,
the shared Fluid moving hover highlight, and Fluid ScrollArea edge fading.

Your Spaces and the sidebar render active memberships from the account Space
index. The Organization discovery snapshot must not veto a newer account index
entry. The account invalidation stream refreshes the index after membership or
message-preview projection, including Spaces not currently open. A 30-second
foreground poll repairs missed events; focus and stream reconnect also refresh
immediately. A newly added Human or Agent owner can discover a Space without
reloading. Unread
counts continue to come from Inbox; joining does not fabricate unread history.

Contract impact: the shared account-sidebar payload adds an optional `chats`
namespace. Auth preserves it when older clients omit it and uses the existing
revision check for concurrent writes. Deploy the updated Auth before Web; old
Auth does not retain this namespace. Core/Gateway session contracts, CLI,
Service, Skills, setup, Wake dispatch and diagnostic protocols are unchanged.
No local-component floor or runtime contract bump is required.

### Plugins

The external-capability catalog is named **Plugins**. Product routes use
`/o/<slug>/plugins`, with one service detail route below it. Plugins is the final
Team tab after People, Agents, Files, and Skills. Both catalog and detail pages retain the Team
header and active Team rail destination, without mounting Center Agent state.
Old `/center-agent/plugins` and `/center-agent/apps` links redirect there,
including service detail links. Web components and navigation helpers use Plugin names.
Vendor terms such as GitHub App and existing connector RPC/tool field names
remain unchanged: this rename does not migrate connection identities, stored
credentials or existing wire discriminants. Account details show separate
Center, Local, and personal Remote Agent permissions. Permission saves use a
server revision check; a conflicting edit must be reloaded, never silently
overwritten. The server owns management eligibility and execution permission.

The catalog and detail pages show the current organization's actual name first,
then **Personal**, using the same scope tabs. Organization is the default;
personal workspaces expose only personal connections. Scope stays in the URL
when opening a Plugin and returning to the catalog. Personal status includes
only the signed-in member's connection; organization status includes only the
shared connection. All members can inspect shared status and permissions;
only owners and admins can change them. Reuse Fluid Select for permission
controls. Detail pages place Connect or Connected beside Website in the header.
Connected opens account information and an explicit disconnect confirmation;
reconnection, unavailable status, and mutation failures retain their real meaning.
Provider components own the snapshot and mutations and supply the header action
through a layout slot, without a second status query or page-owned connection state.
Credential forms and GitHub installation guidance remain below the scope tabs.
Save access sits opposite the Agent access heading and requires an unsaved change.
Loading connection status must not block opening the catalog or a Plugin's
settings. Route loaders do not await connection snapshots; the mounted page
owns loading, cached status, and retry feedback after organization authorization.
The catalog and detail routes start provider and connection prefetches concurrently after
scope authorization, without awaiting them for navigation. It reuses the same
query cache as the mounted page. Known connections can render while providers
are pending; skeleton rows cover unavailable results. The connected filter
uses the current scope's active connections, including accounts needing
reconnection, and combines with category and search filters. Pending or failed
connection reads must not appear as an empty connected list.
Search discovers available Plugins across ownership scopes. In an Organization
search, personal-only results carry a Personal label and open their detail route
with `scope=personal`. Their status comes only from the signed-in member's
connection. Clearing search restores scoped browsing; the connected filter
continues to show only connections in the selected scope.
Cold detail pages can show curated identity and scope navigation immediately,
but setup controls wait for live provider metadata. Skeletons occupy pending
settings; a static Plugin definition does not establish sign-in readiness.

### Organization Skills

Team tabs are **People / Agents / Files / Skills / Plugins**. The Organization Skill
catalog at `/o/{orgSlug}/skills` and detail at `/o/{orgSlug}/skills/{skillId}`
share Team's header, page padding, and rail highlight without a member sidebar. Pending
and error states retain that ownership; neither route mounts Center Agent state.
All members can discover and browse Skills, while Core-projected permissions
control editing and management. Personal workspaces use this same model with
appropriate copy, not a second scope selector or catalog.

Legacy `/center-agent/skills` list and detail leaves redirect with replacement,
preserving encoded identity, hash, and validated global `appSettings` state.
They do not propagate Center Agent conversation selectors or Plugin scope.
Team tab selection starts without inherited search/hash context. Switching
Organizations from a canonical or legacy Skills list/detail opens the target
Organization's list without an old Skill identity. New links use Web route
builders; API paths and Agent consumption contracts are unchanged.

Editing uses the shared unsaved-changes guard and an Organization/Skill-scoped
draft paired with its original release/version. Background refresh cannot give
old content new save expectations or discard a dirty draft. Save completion
preserves newer input. Team navigation, All Skills, browser history, and
Organization switching remain guarded. Upstream `@tanstack/history` reverses
the actual blocked history traversal so cancellation restores the address bar
as well as the page. Keep the installed-dependency regressions for single-step
and multi-step Back and Forward navigation when upgrading the router.

The catalog uses compact rows, one Add skill menu, search and an enabled-state
filter. Account/Organization-scoped, nonpersistent view state remembers filters
and the owning viewport's scroll position; it never stores Skill content.
Detail opens directly into the title, description and Instructions. Optional
Files tabs share the document draft; Properties, history and management use
contextual Fluid menus/dialogs rather than another sidebar or settings page.

`MarkdownEditor`'s optional `presentation="page"` changes toolbar placement,
spacing and near-limit disclosure only. It retains the shared Plate kit and
key-based accepted-content reload contract; default caller presentation stays
unchanged. All presentations report only Plate content changes, not selection
or focus events, so reading cannot normalize Markdown into a false dirty draft.
References mount on first opening and retain visited editors while
hidden to protect queued input and Undo. Legacy section hashes select the
relocated tab or contextual dialog.

Creation and import reuse a shared flow-dialog composition and the real
`UnsavedChangesGuard`/`UnsavedChangesDialog`. Omitting the optional save callback
provides discard-only protection while preserving boolean callers and the
`saved-with-unsaved-changes` result. Mutations keep their original APIs; a URL-bound import
preview cannot be replaced by an obsolete request. Successful writes do not wait
for list refreshes. No route, authority, global Skill installation, autosave or
runtime semantics are added. Desktop Copy link resolves the bridge's Web origin.

The enduring product and authorization contract is
[Organization Skills](../product/organization-skills.md).

### Collaboration presentation

Sending from a conversation or thread Composer returns focus during the send
gesture, before clearing the submitted draft. Draft replacement preserves the
caret at the end only while that editor owns focus. Network completion and
incoming messages do not refocus the Composer, and deferred editor focus is
canceled when another surface takes focus. Existing mention clearing and
message-history navigation rules remain unchanged.

The shared Plate editor must preserve a valid native selection across an
unchanged React render while Slate's deferred selection handler catches up.
Selection synchronization belongs to Slate, not a second Composer listener or
draft writer. The pinned dependency repair and its removal criteria live in
[`patches/slate-react-selection.md`](../../patches/slate-react-selection.md).
Run `pnpm --filter openmeld-web test:editor:browser` for the native selection,
draft, mention, composition, and document-decoration regression matrix.

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

The client reports application errors through the Web-owned diagnostic intake
before attempting Vite version recovery. It preserves the original import
rejection while a reload is pending. Router and React error boundaries, global
errors, unhandled rejections, and resource failures share the same bounded
reporter. Reporting does not decide recovery, mutate application state, or
retry a failed diagnostic request. See `docs/web-application-errors.md` for
the privacy, coverage, and operator query contract.
React update-depth reports capture bounded fixed labels at the Space history
cache, timeline, and Wake projection writers, including whether an existing
signal's Agent controller presentation changed. A later manual report for the
same Error retains that failure-time snapshot. No message, Profile value, or
Space identity is added to the update trace.

The Space composer isolates a rich-editor failure from the conversation shell.
Its plain-text fallback keeps the draft and send action available, while edits
there clear authored mention semantics. A failed editor must not replace the
whole Desktop or Web workspace with the root error page.
If a different React failure occurs in the Space or Direct Message conversation
panel, its boundary keeps the app shell, header, and conversation sidebar
usable, reports the error, and offers a local retry. It does not treat a caught
error as a successful conversation load or erase the underlying failure.
The shared Markdown editor likewise isolates Plate failures for Organization
Documents, Organization Skills, and Space Files. Its fallback shows the owning
Markdown draft as editable source, retains read-only mode and content-limit
feedback, and leaves saving under the existing owner.

Web document responses require browser revalidation so an old HTML document
does not keep stale content-hashed asset references after a deployment.
Vite's content-hashed `/assets/` responses use a one-year immutable browser
cache through the static asset `_headers` policy. This does not change HTML,
authenticated API, or private attachment caching or the version recovery path.

If a page that was already open can no longer load one of those assets, Web
handles the Vite preload failure before router error rendering. The document
shell synchronously replaces the failed route subtree with the existing page
loading surface before requesting one automatic reload. This prevents both an
error-page flash and a second reload from the router's lazy-component recovery.
The original import rejection and diagnostic report remain intact; canceling
Vite's event would instead resolve the failed import with an undefined module.

The browser URL remains the navigation owner, including its search and hash.
Page-content tabs use the root TanStack Router `NuqsAdapter` and the literal
parsers in `lib/page-tab-search.ts`. Routines and Plugins store `scope`; Files,
Spaces, and Inbox store `view`; Skill details store `content`; Usage stores
`usageScope`, including when opened in App Settings above another page. A tab
change pushes one history entry without resetting scroll. The route validator
and the tab hook accept the same values. Files clears obsolete document/folder
selectors and Inbox clears the focused item/request atomically with a view
change. Other supported query fields remain intact.

Canonical path tabs, including Team and conversation headers, retain their
existing route owner. Form choices, hover previews, file display preferences,
spreadsheet sheet selection, and temporary dialogs do not become page tabs.
Skills content tabs retain the mounted draft and allow same-path search/hash
navigation; navigation to another document still uses the unsaved-change guard.
Legacy Instructions/Files section hashes redirect to the content query once.

Existing Composer draft persistence remains the draft owner. Unsaved-change
guards and pending Space sends register recovery blockers using their existing
facts; recovery leaves those surfaces and native navigation warnings mounted
rather than discarding unsaved work to make a deployment look seamless.
Space creation also blocks automatic recovery while its name, visibility, or
submission is unfinished. A failed lazy Settings section stays within the
Settings content boundary, leaving the dialog dismissal, workspace, editable
owners, and pending sends mounted when recovery is deferred. The error remains
reportable; the boundary does not retry writes or replace recovery policy.

Recovery accepts only module-fetch and CSS-preload failures, not arbitrary
exceptions from executing a module. Automatic attempts retain a 30-second
same-tab retry window and coalesce repeated failures within the old document.
If a replacement page still fails, attempt storage is unavailable, or document
navigation throws or has not completed after 15 seconds, Web presents one
explicit refresh action. The navigation deadline bounds only the recovery UI.
Failure copy describes unavailable page files without claiming that a deployment
was detected, and internal asset URLs stay out of user-facing error copy.
Starting another router navigation clears the old recovery surface and its
navigation deadline, while retaining the same-tab attempt marker. Back and
ordinary navigation links remain usable exits after a failed recovery.

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
and product areas. Every title links to a stable entry anchor. Opening an anchor
loads older pages only until the referenced entry is available; ordinary visits
load older entries only through an explicit action.

The page calls the shared anonymous `GET /v1/changelog` contract through a Web
server function. Core remains the validated GitHub reader; Web never imports a
build-time copy, stores a second archive, or manufactures publication state. A
source failure renders an explicit unavailable state with one retry action and
no stale or model-authored fallback.

The account Help submenu reads the latest three updates from the production
anonymous Changelog endpoint in every environment, including local development.
Its Web server function uses the shared API client and schema without forwarding
account cookies or credentials, then returns only entry IDs, titles, and dates.
The browser loads on demand, shares a five-minute query cache, and retains it for
30 minutes after the menu unmounts. The upstream read has an eight-second deadline
and the query does not retry automatically. Existing cached entries remain visible
during refresh; a failed first load shows an error and the official Changelog link.

### Workspace switcher

The top of the rail contains the only workspace-switching surface. Its order
and actions are fixed:

1. the personal workspace, pinned first
2. the member's Organizations
3. **Create organization**, which opens a one-field name form; Auth returns the
   generated Organization URL
4. **Manage organizations**, which opens the full-page Organization manager
5. the current account, which opens a nested **Accounts** view for switching,
   adding, or signing out browser-saved accounts
6. a separated **Settings** utility, which opens **Settings → Personal →
   Account** for the current workspace

No page-level Organization picker or second context switcher may compete with
this control.

Personal Home may show a compact, dismissible link below its introductory heading
to an Organization the account already belongs to. This is a contextual shortcut,
not another picker; dismissal is stored per account in the current browser.

Account switching is browser-wide because Better Auth changes the active
Session cookie. The nested view lists only Sessions saved by Better Auth's
multi-session plugin, marks the current account, allows up to five saved
accounts, and reloads through the account-neutral root after a switch. Adding
an account enters the normal login flow with explicit add-account intent so the
existing Sessions remain saved. Logging out of the current account revokes only
that account's saved Session when available; **Log out of all accounts** keeps
the existing full-sign-out behavior. Every successful account identity change
clears account-private client caches and notifies other tabs before navigation.
Organization selection remains URL-owned per tab after the newly active account
loads; account switching must not add Better Auth active-Organization state.

For `/o/{orgSlug}` routes, the URL selects the current tab's Organization after
the route loader freshly confirms that the signed-in account is a member.
Shared Organization scope and optional account entry reads use Auth's
`GET /v1/account/organization-context` through the existing API client. SSR
forwards the current request cookie directly to Auth; browser and Desktop use
the same Web HTTP route. Both use the same strict projection without a new
preference writer or account store. Browser navigation uses one account-context
Query key, not one membership-list copy per Organization slug. The existing
account reset cancels and removes that query; it is not persisted. Logo and
confirmed membership mutations update or invalidate that same snapshot.
Invitation acceptance must not optimistically invent a membership.
The authorized shell observes the existing Account Session query in the
background, including stale reads after completed path navigation, focus, and
reconnect. Pending or failed renewal never gates the page or invents a logged-out
state. With that observer in place, Web sends `deferSessionRefresh=true` on the
Organization context read so session KV renewal writes cannot block route
admission. Auth still confirms current identity and membership; older callers
without the opt-in retain their existing renewal behavior.
Optional anonymous entry returns
null, authenticated entry without Organizations remains an explicit error,
and an unknown Organization URL remains a denied scope. Required anonymous
scope retains its sanitized login redirect. This read opts into preserving Auth
401 responses through the Web proxy; existing Auth form status normalization
is unchanged. Infrastructure errors are not
converted to anonymous or denied state.

The private `/o/{orgSlug}` boundary is client-loaded (`ssr: false`); public
entry, login, and public content retain SSR. Router default and private-route
pending content use the same visible loading surface so server HTML and client
hydration do not leave a blank screen. The account query has a five-second
transport deadline per attempt and forwards cancellation through body consumption.
When online, a structured `network.timeout` gets one immediate fresh attempt
so a single slow read need not strand the user on the root error page. This
recovery happens inside the read, not Query's focus-paused retry scheduler;
background tabs retain the same bounded outcome. Other failures are not retried,
and account cancellation prevents recovery or aborts its in-flight request.
Offline entry still attempts the read once rather than pausing the parent
loader indefinitely. Two consecutive timeouts reach the existing root error
surface, which owns manual retry and asset version recovery. This is bounded
recovery, not evidence that upstream latency has been repaired. A successful
fresh read projects the URL Organization; only
then may the loader activate its persisted display scope. The component does
not repeat that activation in a hydration effect. The loader checks cancellation
before entering persistence activation and before returning its scope; the
persistence owner serializes scope changes. An anonymous result clears account-private state
before the sanitized login redirect.

Ordinary primary-button or keyboard activation of a rail link whose complete
resolved URL already matches the current URL is a no-op for routing and still
closes an open navigation drawer. Modified clicks and new-tab targets retain
native behavior. Section highlighting alone must not suppress navigation from
a child page or a different query/hash. This prevents an accidental same-URL
navigation from forcing another parent admission read; explicit refresh and
account/Organization changes retain their existing checks.

Each Organization context request carries a client-generated request ID through
Web and Auth. The ID survives a timeout before headers and is included in
copyable error details and the existing sanitized error-report projection.

The
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

The shared conversation sidebar defaults its built-in sections to expanded and
custom groups to collapsed. Inside a Space, its containing group temporarily expands even when the saved choice is
closed. Manual toggles during that visit take precedence until another Space
is entered. Returning to the directory restores saved choices. These browser-local
choices are isolated by profile and Organization; automatic expansion is never
persisted as a user choice. Collapsed group headers retain
aggregate unread counts from the existing Inbox projection. Main-content group
disclosure remains independent from Sidebar disclosure.

The rail places the current workspace switcher at the top and has no separate
OpenMeld brand row or outer-rail account entry. Account management stays nested
inside the workspace switcher. The primary destinations are flat and fixed:

- **Inbox** — opens the current workspace's attention feed.
- **Spaces** — opens the existing chat directory, with Spaces and private
  conversations available in its contextual list.
- **Team** — opens the people directory. Each person's profile owns their Agent list.
- **Routines** — opens personal and shared scheduled work and Run history.

**New Agent** remains a contextual creation action. It opens
`/o/{orgSlug}/new-agent` with the primary rail and no Agent-list sidebar,
reusing the existing creation flow. Success opens the new Agent's detail;
Cancel returns to Agents. Pending teammate requests open Agent requests.
Legacy `agents?view=create` links redirect before loading the directory.

The middle column contains the active module's list. Spaces and Direct messages
are groups within Spaces, rather than duplicate application-rail links.

**Projects**, **Documents**, and **Agent Activity** keep their canonical routes,
pages, and contextual entry points but are temporarily absent from the primary
rail while their future placement is redesigned. This interim navigation
change does not retire, redirect, combine, or relocate those products.

Team is a single link in every rail tier, with no disclosure trigger or nested
People/Agents children. Old saved Team collapse preferences do not hide it.

The visible destinations resolve in this order: **Inbox**, **Spaces**, and
**Team**, with **New Agent** in the separate Create action. Team's existing
**Agents** page at `/o/{orgSlug}/agents` offers **All Agents / My Agents** views,
in that order. All Agents remains the initial view. Neither the toolbar nor a
group header shows a count. My Agents shows only the signed-in member's
ordinary Local and Remote Agent Profiles in the current workspace, excluding
managed Center Agents. It starts ungrouped unless the member has chosen a view.
Both views reuse the existing cards, filters, and canonical person-owned detail
and settings. A card opened from this directory provides **Back to Agents**.
The selected scope, search, filters, sorting, and grouping are browser preferences
scoped to the current account and workspace, so returning from detail restores
the list. These preferences contain no Profile, permission, or readiness facts.
My Agents adds no separate navigation destination, identity, or permission owner.
Under the signed-in member's own Agents, an unfiltered list shows **Found on
your computers**: the installed harnesses that are turned off in Local agents,
from Core's catalog sync, each with **Add**. Add asks Core to add that harness,
which turns it on where it is installed and creates its Agent and Direct
Message (`developing/product/agent-profiles.md`, MemberAgent Layer).
Agent cards in the list draw their hover background on their own card layer;
the menu-level shared hover indicator stays off behind opaque cards. Every
group header, including the signed-in member's own Agents, offers the shared
collapsible-header actions: select, search, view settings, and collapse.

An Agent (MemberAgent) has one page: its default Agent Profile's page. Opening
an Agent from the list or from **Agent settings** in a Spaces sidebar Agent row
menu navigates to `/o/{orgSlug}/agents?memberAgentId=…`; opening another
Profile of the same Agent uses the canonical person-owned Profile route. Both
render the Profile page with **Back to Agents** and the Agent's sidebar. There
is no separate MemberAgent detail with its own State, Computers, Work, or
Latest Session cards. The sidebar is titled with the Agent's name and has
**Active** and **Archived** tabs with icons that split the sidebar width evenly,
plus chat search. With one Profile it lists that Profile's Sessions directly.
With several, each Profile is a row that opens its page, its Sessions are
nested under it on the sub-menu guide line, and a chevron at the far right
folds them. The open Profile's selection covers only its row. The page header
puts **New <harness>** (for example **New Cursor**) beside **Chat**; it opens
Create Agent pinned to that harness and is absent for Remote Agents. Grants and
the Agent's sensitive changes sit in one **Who can use this Agent** section,
collapsed by default, with its own Fluid scroll area. Working-folder recovery
keeps its entry on the Profile page.
Ordinary Human–Agent chats use Core's Session archive state in the chat menu,
conversation sidebar, and Agent page, including chats with colleagues' Agents.
The Human participant can archive or restore their own Session; owning the
Agent does not give an observer those controls. Personal sidebar archive
preferences do not override this Session state.
The product destinations are:

1. **Desk** — renders ordinary Space windows and a greeting on the shared infinite
   React Flow canvas. See **Desk and Chats** below for selection, creation,
   persistence, and viewport behavior. Space interactions use the full Space
   owner. A bottom-right Add to Desk button opens a categorized widget dialog;
   shared compact conversations provide Chat windows, including Center Agent.
2. **Spaces** — the current workspace's Space collaboration surface.
   Spaces, Direct Messages, and People place their contextual lists
   in the middle column, separate from the fixed application rail. Each list
   has one Fluid scrolling area. People groups stay inside Team's contextual
   region; a person's Agent list and detail use full-width content. These pages do not
   mount an additional contextual column or simultaneous mobile drawers.
   Existing list grouping, pinning, unread indicators, identities, and status
   projections are preserved. Spaces owns the shared creation menu and
   discovery links described above.
   Agent list search and filtering remain available. Settings retains its
   secondary navigation panel.
3. **Direct Messages** — the current workspace's private one-to-one
   conversations. Its canonical routes are `/o/{orgSlug}/direct-messages` and
   `/o/{orgSlug}/direct-messages/{spaceId}`. The Main Sidebar's contextual
   list shows current DM Spaces by the other participant's profile identity;
   selecting one opens the existing Space conversation surface in the content
   region. Direct Messages remain a distinct conversation kind within Spaces;
   this presentation does not create a separate DM data or messaging subsystem.
   People and Agents entry points navigate
   straight to this route family after opening or reusing the DM. Its pending
   state uses Direct Messages geometry and never flashes the Spaces sidebar.
   Canonical classification reads the Space status projection; the Account
   Space Index is list data and cannot override a fresher status result.
   In a one-Human/one-ordinary-Agent DM, a badge beside the conversation title
   tells other participants that the named Agent owner can view. The owner sees
   `View only` while observing, and no self-visibility badge while participating.
   Access labels never appear among navigation tabs. DM headers and new-chat
   headers omit Local, Remote, and Center Agent type badges.
   When that owner opens the DM through their
   own Human Profile, Web keeps the Composer and collaboration mutations
   read-only and offers **Join conversation**. Confirmation reuses the existing
   **Turn this Direct Message into a Space** flow and adds only that owner's
   Human Profile. Human-to-Human and Center Agent DMs never show this owner
   observer or join affordance.
   The read-only Composer says `Join this conversation to send messages.` in
   its input area once; the action row does not repeat the placeholder.
   Direct messages and ordinary Spaces share the Members panel and its People & Agents
   grouping. An Agent owner who has not joined appears as an identity heading
   above their Agents, using the Organization Profile Directory name and avatar.
   This heading does not create membership, count toward Members, or expose
   member actions for that owner.
   Message bodies use the same Profile Mention renderer for Human mention
   targets and Agent Wake/Reference targets. Human tokens retain their avatar,
   name, and Profile popover without an Agent action label. The timeline carries
   all three existing addressing lists without changing notification or Wake
   semantics.
   Long message previews share one folding policy across Spaces, Direct messages, and
   threads: finish the paragraph or Markdown block crossing the soft character
   limit of 2,000 characters, then offer **Show more**. Folded text shares the
   Scroll Area's bottom edge fade; the button stays outside the mask. Expansion
   removes the fade and displays the original message;
   local folding never cuts words, lists, tables, or code blocks. Server-side
   truncation remains a separate, explicit condition.
4. **People** — the first-level home for the Human teammates in the current
   workspace. Its Main Sidebar contextual list shows Human Profiles with search,
   computer-connection filters, personal Starred and named groups. Registered
   Computers alone do not qualify as Connected: use the existing service-state
   projection. The default Online and Offline groups describe Human presence
   from the independent Core-owned session projection. Unknown Human presence
   stays unclassified under People. Computer connected, Computer disconnected,
   and never-connected Computers remain distinguishable in independent filters.
   Human
   `lastActiveAt` is recent authored activity, not online presence.
   A row's Chat action reuses the existing Direct Message entry point and is
   available only for another active Human Profile.
   Selecting a person opens the full Human Profile
   detail as the main content, including that person's Computer cards. Inviting
   remains role-gated. The personal workspace shows the current member and the
   existing create-Organization guidance instead of pretending that invitations
   are available there.
   The current user's profile places **Agent conversations** between Agents and
   Computers. It filters the existing Account Space Index by currently owned
   personal Agents, groups each conversation once, and supports an Agent filter.
   The bounded Fluid Table uses the shared Scroll Area, scrollbar, and edge
   fades. Links reuse the existing Direct messages/Spaces viewer identity and access
   rules; this is not a separate interaction log or an Inbox history. Other
   people's profiles do not show this section, and organization ownership does
   not grant access to managed Center Agent private conversations.
   An owned Agent's detail page reuses this same **Agent conversations** section
   below its configuration, scoped to that Agent. It omits the Agent selector
   and repeated Agent column. Loading, errors, empty states, ordering, and
   conversation navigation share the Human profile implementation. These rows
   describe accessible conversations the Agent has joined, with the latest
   conversation preview; they do not claim a complete execution history or
   that the latest message was authored by this Agent.
   When a row has a message preview, its link includes that exact Signal target.
   Thread placement comes from the shared Space thread catalog. Explicit targets
   take precedence over a previously saved open Thread, and target message reads
   begin alongside Space prefetch. Known Thread targets and saved open Threads reserve their panel
   during access and bootstrap checks without rendering protected messages early.
   Each Inbox row or notification activation carries a new in-memory focus request,
   so selecting the same target again reopens its Thread and refocuses the message
   without remounting the conversation or discarding its draft and read cache.
   Only a full Thread history read initializes the reply-history cache. Live
   replies may extend an existing snapshot and update the separate preview, but
   cannot turn an unread history into a successful query. A missing linked reply
   is reported only after the current history read finishes; refreshing or paused
   reads are not evidence that a reply was removed or access was lost.
5. **Agents** — the first-level home for ordinary Agent Profiles that members
   manage. User-facing management copy calls them **Agents**; `Agent Profile`
   remains the internal identity-model term. Its Main Sidebar contextual list groups
   Agents by owner and the main content shows the selected Agent's complete
   detail. The page shows each Agent's identity, owner visibility,
   authoritative readiness, and execution relationship in plain language such
   as **Uses Codex on Felix's MacBook Pro**. The managed Center Agent remains in
   the separate Center Agent product home.
   The ordinary Space member picker explains the owner side effect before
   submit: an ordinary Agent whose owner is not already present is labeled
   **_Owner_ will join too**. Once the owner is present, the row may use the
   stable **Owned by _Owner_** identity label. Center Agent candidates keep
   their managed Organization label and never promise an owner addition. Core
   remains the authority, so a stale picker cannot bypass or duplicate the
   atomic owner membership rule.
   The temporarily hidden product homes retain their current contracts:

- **Projects** is the canonical home for choosing, creating, and connecting the
  code Projects used by local Agents. Project records are scoped to the selected
  Organization; local folder connections remain owner-self, device-local
  execution facts.
- **Documents** is the Organization-scoped Markdown home for the Organization
  Brief, Profile Reports, and shared knowledge, organized into nested folders.
  It has no secondary sidebar; the current folder's child folders and files live
  inside the page itself.
- **Agent Activity** is the canonical home for local coding-agent session
  visibility. Its route remains `/o/{orgSlug}/agent-activity`; the full label
  prevents confusion with human activity and the Center Agent Audit Log. Its
  secondary sidebar groups **Overview**, **Sessions**, and **Changes** under
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
navigation is exactly **Messages**, **Graph**, **Files**, **Routines**,
**Channels**, and **Memory**, in that order. Skills management belongs to Team.
Messages, Graph, and Files preserve the selected Center Agent conversation
surface. Their compact header menu preserves **Chat settings**. Routines,
Channels, and Memory omit that menu because they have no additional actions.
There is no separate About surface or Slack shortcut; Center Agent identity,
model, status, and Slack management remain available through Center Agent
settings and Channels.

**Center Agent settings live in the global App Settings destination**, not in the
Center Agent conversation header menu. Its canonical route is
`/o/{orgSlug}/settings/center-agent`, registered as the `center-agent` Settings
section, so the same panel renders in both the standalone Settings route and the
global Settings dialog (`?appSettings=center-agent`). The section is grouped
under the current Organization's name, and under **Personal** in a Personal
Workspace, where the coordinator belongs to that one member. The historical
`/o/{orgSlug}/center-agent/settings` route remains as a redirect only, so
existing links keep working without a second copy of the panel. There is exactly
one Center Agent settings entry point.

The Inbox launcher is present across ordinary authorized routes and opens a compact
preview first. The sidebar header alone shows the deduplicated attention count
(visually capped at `99+`); the bottom-right launcher colors its icon and label
without a number. Both consume the same Core summary: red for open actions,
otherwise amber for unread urgent updates. Unknown summaries never become zero.
The preview shows unread context and a bounded list of recent
items grouped as **Needs action**, **Needs review**, **Urgent updates**, and **Recent updates**, preserves source
navigation and read-on-open behavior, and exposes a clearly labeled maximize
action to `/o/{orgSlug}/inbox`. One group does not hide the other. Its width and
height must remain usable in narrow viewports. Ordinary non-urgent unread updates never
inflate the launcher badge. The far-right global control group contains a Center Agent
launcher. The Center Agent launcher is hidden while full Chat
is open. Elsewhere its compact view mounts the same `CenterAgentPage`,
`SpaceLanding`, conversation timeline, live Agent stream, Stop control, and
Space composer used by full Chat. Sending stays in the compact view and writes
directly to the canonical Center Agent Direct Message. Maximizing unmounts the
compact owner before the full route mounts, so Web never runs two live-stream or
writer owners for that conversation. Inbox and Center Agent
are separate controls and truths, and at most one compact panel is open at a
time.

### Desk and Chats

Message action hints share one native Tooltip instance per mounted Space,
including its Thread panel. Opening or leaving a Desk Space therefore does not
mount or tear down a separate tooltip root for every message action. Pin
providers expose the stable mutation function directly so an unchanged pin
snapshot does not invalidate the message subtree on unrelated parent updates.

The first Desk release enables adding Spaces and text only. Other widget
categories remain commented out in the picker, with their implementations and
existing browser layouts retained. Text is added from the canvas context menu.
The broader widget behavior described below is implemented but not offered for
new additions in this release.

The Add to Desk dialog groups Spaces, Chats, Updates, People, and Computers in
a sidebar. New accounts do not automatically receive additional widgets.
Chats reuse the same DirectMessagePicker as the Chats page;
opening a conversation on Desk changes its presentation, not membership or
message ownership. Inbox, Center Agent, and Computer cards reuse their existing
product components. Existing singleton widgets are focused instead of duplicated.
Window titles, geometry, and text are browser-local per account and Organization.
Titles sit immediately above their window and move with it. Dragging a title
moves the window; clicking it enters editing. Text uses the same interaction and
starts at its content size. New information cards use intrinsic height, while
conversation windows retain a bounded viewport. Manual resizing remains available.
Desk Inbox shows the six most recent items, including read records, using the
shared Inbox list and read mutation. The Toolbar preview uses the canonical
grouped Inbox feed, including read history and unresolved requests, with
continuous pagination and a fixed **Open full Inbox** link.
People & Agents embeds the Space candidate selector, with independent selection
of each person or agent. Each selection adds a Profile card instead of a directory
widget. The card uses the shared Profile identity header and offers a Chat action.
Visible Profile IDs are the source of truth for the picker's checked, disabled
state; closing the card makes that identity selectable again. Selection does not
add anyone to a Space or implicitly select an agent's owner. Profile cards read
current readiness and operational status from the authorized directory, including
reported queue counts; they do not infer activity from presence or local sessions.
Closing a window removes only its Desk placement. It does not delete its source.
Text is a canvas tool available from the context menu, not a widget category;
users edit it directly and resize it. Layout changes can be undone locally.

Active agents reads the existing authorized active-Wake summaries for accessible
Spaces and chats. Reads run four at a time and refresh every minute while the
widget is mounted and the browser is active. They do not infer execution from
presence or expose local coding-session observation. Partial read failures are
visible and never reported as an empty work list. This first version is an
active-work view, not a history or an organization-wide private-conversation feed.
Each row identifies the Agent, its owner when available, its Space, and progress.
No membership, Wakeability, execution, or permission owner changes are introduced.

The authorized Organization root `/o/{orgSlug}` redirects to Spaces. Default
authenticated App entry also opens the current Organization's Spaces. Explicit
Center Agent conversation links keep their existing destination. **Desk** remains
available by direct link at `/o/{orgSlug}/desk`. It remembers
its visible Space windows in this browser per account and Organization. Without a
selection it reuses a marked Welcome Space (or an existing joined `Welcome Space`),
or creates a private, members-only `Welcome Space` through the ordinary creation
flow when none exists. It never selects an unrelated ordinary Space by default.
An old automatically selected ordinary window is replaced by Welcome; other
saved windows and user-created layouts remain intact.
There is no special Space kind or membership policy. A browser lock prevents
concurrent tabs from creating duplicates; a pending marker prevents blind
retries after an uncertain creation result. This is not cross-device atomic
provisioning. A confirmed deleted Space is removed from Desk and is not recreated.

Welcome tutorial identity is browser-local, keyed by account scope and Space ID,
independent of the editable name. The shared Space page and directory read this
same marker. Creation adds only the acting human. The first Welcome member picker
opening recommends and preselects the designated Center Agent, without adding it
until Add selected. Deselecting or closing does not reapply that default. Ordinary
Spaces never preselect it. Its shared picker description explains its workspace
role. The guide reuses the existing setup card and member dialog;
ordinary Spaces keep their existing setup guidance. Welcome Spaces show one
centered dashed action card, first **Add your first agent**, opening the shared
member selector. Welcome empty content uses the shared panel's start alignment
so the action is visible in the initial Desk viewport; ordinary empty Spaces
retain centered alignment. Center Agent can complete the same path as any other
Agent; existing Welcome members are preserved and can start the conversation.
Confirmed member additions
prepare an editable draft only when the Composer has no text, files, or reply.
Agents receive Wake mentions; people receive ordinary mentions. Nothing is sent
automatically. The introductory message greets the added members and asks for
a brief introduction; it does not invent a business task. Clearing
the draft exposes **Start a conversation** in the same card. Its saved recipient
IDs are draft intent only and are reconciled against active Space members before
restoring a draft, using current names. Existing text, files, and replies are
preserved. There is no separate Center Agent sample-task shortcut.
The action card appears only in an empty conversation. Once conversation entries
exist, it stays out of the timeline's top overlay, including while an Agent is
working. A real final reply from an added Agent to a newly sent user message completes
the guide, which then disappears. No skip, resume, or replay controls are exposed.
Legacy paused progress resumes from its saved step. This guide does not change permissions,
Wakeability, execution ownership, or server-side Space semantics, and does not
sync its progress across devices.

Desk Space windows use React Flow's native edge and corner resizing, bounded to
720–2400 canvas pixels wide and 480–1800 high. Window dimensions are remembered
per window, account, and organization in this browser, independently of the viewport.
Resizing changes only the canvas container, not the shared Space implementation.
New windows fit the Desk's available width and height with 32px canvas margins,
within the existing size limits. Small viewports zoom out enough to show the full window.
Desk conversation rails fill the available width up to the shared centered-page maximum
(`--space-conversation-centered-max-width`),
with 24px inline padding, reduced to 16px in narrow containers. Wider windows
add outer whitespace rather than lengthening text lines. Appearance's centered/full-width preference applies
only to page surfaces. Desk passes its measured width into the shared Space so
the Members side-panel breakpoint follows the window rather than the browser.
Local development lanes expose Reset Welcome Space at the top-left of Desk.
The greeting is selectable and resizable; selection reveals its border and close
button. Its geometry shares the Desk layout storage. Closing it persists an
account-and-organization-scoped browser preference, with no restore action.
Dismissed greetings skip the greeting entrance even when the viewport is reset.
It creates a new private ordinary Space with only the acting human, initializes
Welcome guidance, and clears the current Desk window and viewport preferences.
Existing Spaces and their messages remain intact. Production builds omit this action.

Desk and Space Graph share `WorkspaceCanvas`, with independent React Flow
providers. Desk mounts the same full `SpaceLanding` as the Space route, including
setup guidance, Messages, Graph, Files, members, sharing, and threads. The same
responsive rules determine the member surface. The mounted Space survives
panning and zooming; no preview copy or parallel conversation state exists.
The maximize link opens its canonical route. The shared member selector uses
the workspace directory in both Personal and Organization contexts, including
the workspace's own Center Agent under the existing membership authorization.

The first visit starts with a blank canvas, reveals the centered greeting with
a subtle scale-in, then the arrow, then the Space. The viewport pans down to
center the complete Space, including the Composer. Pointer, wheel, or keyboard
input interrupts the entrance and reveals all content. Reduced motion shows
the final view immediately. The viewport is remembered locally; Reset view restores
the fitted Space view. Scrolling a clipped Space reveals its lower content
before the ordinary conversation scrolls. Embedded Graphs own their wheel input.
Bottom-left controls collapse to a Canvas tools button and expand on mouse hover,
keyboard focus, or tap; leaving waits briefly before closing. Their opacity-only
transition is disabled under reduced motion. The canvas context menu offers
Add Space, Reset view, and Reset layout. Add Space searches existing joined Spaces
in the current organization, marks displayed windows On Desk, and links to the
standard Create Space route. Empty Desk also exposes Add Space. Closing a window
only removes it from the persisted Desk layout; the Space remains in Spaces and
can be added again. Confirmed deleted Spaces are removed from every Desk window.
Reset layout restores
the greeting and Space positions and default dimensions, clears the saved size,
and resets the viewport without remounting the Space. Context menus inside the
Space remain owned by the shared Space interface.

`/o/{orgSlug}/chats/center-agent` remains the canonical full Center Agent page.
Explicit legacy `session`, `draft`, focused-signal and view selectors on the
Organization root redirect there, preserving their intent.

Direct messages at `/o/{orgSlug}/chats` replaces the Messages navigation destination.
It stays on a conversation directory, sharing sidebar grouping, sort order,
previews, and unread projections. Loading never presents a false empty state
or automatically opens a conversation. A genuinely empty list offers New message.
New message and Space members share the people-and-agents picker, including search
and nested agent ownership. Both entry points offer **New Agent** through the
same inline creation step. Back preserves the current query and selection.
Successful creation returns to the picker, clears its search, refreshes the
Organization directory, and selects the new Agent alongside any existing
selection. Creation alone does not open a conversation or add Space membership.
If the New message directory refresh fails, show that the Agent was created and
offer a retry without repeating creation. One explicit selection opens a direct
conversation;
multiple selections create a new private, members-only Space through the existing
Space creation and directory membership APIs. A successfully created Space is
retained while retrying failed member additions. Selecting an agent alone does
not implicitly turn the new chat into a group; ordinary Space membership still
applies the server-owned agent-owner admission rules.

The Space member picker makes direct additions the primary selection action;
Agent creation and email invitations remain separate secondary actions. Opening
the picker revalidates stale Organization candidates through the existing shared
query, reusing fresh data and in-flight reads without blocking cached rows or
clearing valid selections. A failed refresh retains the last results with a
visible retry action, separate from membership-submission errors. Space membership
continues to come from the Space snapshot, not the Organization candidate cache.

In the shared conversation sidebar, Pinned, Spaces, and Direct messages start
expanded unless the viewer has saved a manual choice. Custom groups start
collapsed. Entering a conversation reveals its group; switching views preserves
both families' existing disclosure choices. Search temporarily reveals matching
groups without writing disclosure preferences. Creation, view selection,
filters, and search live in the Spaces header.
Ordinary private conversations use `/chats/{spaceId}`. The old
`/direct-messages` routes only redirect and preserve supported search fields.
Team's Center Agent entry opens the canonical Center Agent chat.

The shared sidebar deduplicates ordinary Spaces, People, Local, Remote, and
Center Agent conversations by Space identity. Ordinary Space rows come from
the current Organization's authorized Account Space Index; direct messages
reuse the existing peer/title resolution and paged Center Agent session list.
Center Agent chat avatars resolve the session's canonical `centerAgentProfileId`
through the same lightweight profile directory used by other chat identities;
they do not wait for designation or full readiness-directory queries.
The global command center uses these same titles and exact destinations,
including the Center Agent session selector. Space-name search remains bounded
by the existing 500-item Account Space Index query; this UI change does not
introduce a server search endpoint or claim unbounded history coverage.

Grouped retains existing per-section Priority and manual sorting. Both views use
the existing fixed status slot so revealing or focusing row actions cannot move
or cover activity indicators. Priority sections wait for their first activity
snapshot before showing an idle ordering; manual pins and Recent remain usable
while that evidence loads. Full names and attributed activity remain available
through the shared tooltips. Preview text is a separate message link beside the
row's ordinary conversation link, with a subtle underline on hover or keyboard
focus and no size change. It preserves the exact preview Signal ID and session
selector, using the shared message/Thread focus resolver even outside the loaded
history window. Needs-input copy and previews without an ID remain plain text.
Row actions retain their own hit targets; menus reserve enough width for labels
and use the shared action icons. Ordinary Space rows read Index previews without
creating per-Space message-preview observers. Rows use
the same preview and activity sources for selected and unopened conversations;
navigation is not required to discover their latest message or pending action.
Recent uses message, creation, and joining time, with Space ID as a stable
tie-breaker; unread, visit time, and running progress do not promote it. Recent
rows can be dragged to Pinned; Grouped also exposes compatible personal groups.
Recent does not permit manual row ordering outside Pinned. Layout intents render
immediately from pending account-scoped query mutations. Native mutation scopes
serialize saves against the latest confirmed sidebar revision; a pending save
does not disable the list or delay a drop. Pin membership remains owned by Space
Index, independently from personal ordering. Keyboard and reduced-motion drops
have no travel animation. Space and direct-message
custom groups retain their existing preference owners; cross-kind moves are
rejected before any pin or preference write. Rename and archive remain direct-
message actions and are never offered on ordinary Space rows.

Existing `messages` and `chats` preferences are merged
without losing pinned items, custom groups, titles, or archived conversations;
the next write stores the unified `chats` preferences and retires `messages`.
Ordinary DM pin membership remains Space Index-owned and uses the same pin
mutation as Spaces; session pins and sidebar order remain account preferences.
Center Agent rows reuse the designated profile avatar. Core's complete Inbox
summary owns Chat unread and attention facts. Normal unread is blue, urgent
updates are yellow, and open action requests are red with precedence over yellow.
Reading clears unread updates, not unresolved requests. Counts never sum a loaded
page. Notification targets preserve the exact conversation, message, and thread.
New chat uses the existing participant picker. Choosing Center Agent opens a
local draft; first send continues to own session creation. Its group actions,
archive filter, title editing, previews, and drag ordering remain available.

The full Center Agent page, header, starter cards, composer, and all capability
surfaces reuse their existing components. Messages, Graph, Files,
Routines, Channels, Memory, settings, and conversation
information remain available. Center Agent work routes stay under
`/center-agent/*` and highlight Direct messages; Skills management instead lives
under `/skills` and highlights Team, and settings remain in global App Settings.
The starter cards continue scrolling with the conversation.
No second conversation controller or message store is introduced.

### Inbox

The canonical route is `/o/{orgSlug}/inbox`. The bare authorized Organization
route renders **Desk** after current membership and Organization identity are
resolved. Inbox remains a lower-priority global utility reached from its
bottom-right launcher; it must not become the default authenticated or
post-onboarding destination. Inbox uses the full-width inset app surface without
an empty secondary sidebar.

The full page is also reached from the permanent bottom-right Inbox launcher's
maximize action. The full page, compact launcher preview, and shared attention
indicators opt into Core's mute-aware attention presentation. Muted ordinary
updates remain raw unread history; open actions/reviews, unread urgent updates,
and unread structured Human mentions remain presented. The notification reader
continues to use the raw list because delivery policy is evaluated separately.
The compact preview reads the same Core list and summary, uses the same
structured source mapping and read mutation, and owns no parallel unread state.

The page provides **All**, **Unread**, **Needs action**, and permission-gated
**Needs review** filters, an explicit **Mark all as read** action, and a
chronological Fluid item list. Opening an item starts its idempotent mark-read
mutation as part of the same in-app navigation to the structured source target;
the mutation survives the source route change. Hover, viewport exposure, tab
focus, and browser focus never mark items read. Every row also exposes
accessible read/unread and **Dismiss** actions. Dismiss optimistically removes
the row and updates unread and attention counts, restores the exact prior cache
on failure, and never changes source state. Dismissing a directly linked item
also clears the item selector so Web does not present its deliberate removal as
an availability error. Mark all targets the same attention presentation, so
hidden muted ordinary updates are not silently read.

The optional `?item={itemId}` deep link reads that exact recipient-authorized
Core item by ID, places it in the canonical **All** view when it is outside the
currently loaded list, focuses it, and marks it read once. It never searches a
bounded number of list pages or treats list depth as item availability.

Space message links load a bounded window around the exact target when it is
outside the rendered conversation. They reuse the existing history-navigation
owner for earlier/newer context and return-to-latest behavior, rather than
searching a fixed number of pages from the live tail. A newer navigation cancels
the previous lookup. Main-message links take precedence over a previously open
Thread; explicit Thread links still open the Thread shell before replies load.
If an explicit main-message anchor is unavailable, the same history owner reads
the latest messages from that Space through the authorized API and explains the
fallback in plain language. It never searches another Space for the message.
Access and transport failures do not become successful fallback navigation, and
server diagnostic text is not rendered as the navigation error.
Selected history windows use the existing Query retry, reconnect, and focus
mechanisms. A successful live-tail reconciliation also refetches idle, failed
active windows for the same Space and acting Profile, so proxy recovery does not
depend on a browser online event. Missing pagination anchors and permanent
access/client errors are excluded from automatic recovery; the existing bounded
retry policy still controls transient failures. New navigation cancels the old
request. Route focus, history-rail, pinned-message, and unread-message jumps all
complete their original navigation when the selected window recovers. One top
banner owns the history error and its right-aligned **Retry** action. A missing
pagination anchor or permanent access failure does not offer Retry; the message
directs the reader to latest messages or Inbox. Newer-history loading does not
repeat the banner's recovery control. Returning to latest cancels any retained
history-rail scroll target. Public pinned-Thread jumps also finish after recovery.
A missing message's fallback notice survives the automatic return to latest and clears
when another history target is selected.
Inside a Thread, the root message's details offer **Show message in Messages**.
This in-page action closes the details drawer and focuses the root in the main
conversation while retaining the open Thread. It reuses the same bounded
history-window loader when the root is outside the current window; later route
navigation supersedes the local focus request. Thread-only replies do not offer
this main-conversation action.

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

Browser observation uses `/v1/inbox/notification-observations`, with a bounded
insertion cursor and the existing pending-item ledger. The first response is an
empty baseline, not historical replay; subsequent pages are retained before the
cursor advances. This avoids first-page loss during bursts and delayed source
projection. A visible Web window must also have document focus to suppress its
current-conversation notification or automatically mark a message read.
While visible, the same lightweight cursor is checked even when browser
notifications are off, on the cadence described under the account invalidation
stream. A new Space message invalidates the account
Space directory, which remains the authority for sidebar previews; the five
second directory poll still covers membership and delayed projections.

### Notification settings

**Settings -> Personal -> Notifications** owns phase 1 delivery preferences:

- **Default message notifications** saves the account-wide All new messages or
  Mentions and replies default. The shared Space/DM header bell exposes Use
  default (with its current value), both explicit choices, and Mute message
  notifications. The selected value comes from Core; failed saves preserve the
  last confirmed choice and show the error. A conversation override belongs to
  the signed-in member, not the displayed Agent Profile. The bell links to
  global settings and explains that urgent email remains independent.
- **Show an example** requests a local sample notification beside the browser
  control. It is disabled until browser notifications are enabled, never writes
  an Inbox item, and does not claim that a native banner was displayed.

- **Browser notifications** reflects permission in the current browser and
  explains when the browser has blocked the permission. If permission is still
  undecided after Account Setup Studio, Web presents one browser-local
  introduction that explains the benefit. Only the member's **Enable
  notifications** gesture requests native permission; rendering the app never
  opens the browser permission prompt. An existing browser grant defaults this
  setting on unless the member has explicitly turned it off. **Not now** only
  dismisses the introduction for that member in that browser, and Settings and
  Space Info remain the durable discovery and control surfaces.
  Storage-read and pending-record write failures appear as paused delivery,
  independently of the saved switch value. The sample and unusable switch stay
  disabled without saving a new preference. After a write failure, bounded
  background observation refreshes and focus/visibility events verify allocation
  with a temporary write/readback/removal before clearing the pause, even if the
  originally failed message is already read.
- **Play OpenMeld sounds** is a member- and browser-local preference that
  defaults on. Web plays `ready` for ordinary directly addressed updates and
  `chime` for urgent or open action-required notifications, only after the
  browser acknowledges display with `show`. Constructor success is not delivery;
  error or missing acknowledgement keeps the attempt retryable. A 350-millisecond
  batch produces one cue, with `chime` winning mixed bursts. Playback stays at
  the fixed full app volume, and the setting explains that browser or operating
  system notification sounds are controlled separately. Blocked or failed
  audio does not change delivery truth or trigger a notification retry.
- **Urgent email alerts** is a durable account preference, enabled by
  default, and may be disabled without hiding Inbox items.

Phase 1 intentionally has no schedules, quiet hours,
digests, snooze, Slack delivery, closed-browser Web Push, Desktop, Mobile, or
CLI controls.

### Settings structure

**Personal → Spaces** contains **Automatically wake the only Agent**. It is on
by default and uses the shared Settings row and Switch. Its account-owned value
applies across organizations. Conversation guidance uses Core's Space status
projection, so turning it off removes automatic-Wake guidance as well as implicit
work admission. Explicit Agent mentions remain available.
The row uses one full-width composer preview. Its message explains the saved
choice directly: automatic replies without a mention when enabled, or an explicit
Agent mention to request a reply when disabled. This explanation remains available
to assistive technology; the decorative toolbar is hidden from it. The static
preview is not an editor or an execution-status projection. Send-shortcut cards
use the same decorative composer, with the product send icon and one keyboard
hint for the option's sending action; they do not repeat the newline shortcut.

The same section owns personal conversation preferences. Reading contains
**Conversation layout**, **Your messages**, and **History slider**, moved from
Appearance without changing their browser-local keys or defaults. Conversation
list contains **Message previews**, using the same browser/profile/organization
preference as the sidebar display menu. Fluid radio cards show the reading and
list choices with static previews and stack on narrow screens. Appearance keeps
global theme, shape, navigation, toolbar, and Bot avatar controls.

Sending also contains **Send shortcut**. Enter sends by default, and Shift+Enter
inserts a line. The optional Cmd/Ctrl+Enter choice makes unmodified Enter insert
a line. It uses one browser-local preference in the shared composer across
Spaces, Direct Messages, Center Agent conversations, creation, and Threads.
IME composition and mention-picker confirmation never submit a draft. The
plain-text recovery input retains the same send rule. Inline message editing
keeps its existing Enter-to-save behavior. Mobile Send buttons are unchanged.

Account display reads use Auth's `/v1/account/session` projection through the
shared API client and the existing `userQueryKeys.session` cache. The projection
preserves the Joined date, verification badge, name/avatar identity updates, and
current-session row identifier. SSR forwards only the current request's cookie
to configured Auth. A 401 means no session; backend or malformed-response failures
remain visible query errors. Security, device switching, and token-based session
revocation keep their separate existing Web contracts. See the
[Account session contract](../architecture/shared-contracts.md#account-session-read).
The Auth read preserves vendor-owned browser session renewal and deletion cookies
through the HTTP proxy, separate from the credential-free JSON projection.

The application rail keeps only the account trigger in its footer. Search,
Settings, and theme controls are available in its menu. Desktop update attention
appears on the account trigger and the Settings menu entry.

Normal Settings entry points open the global **App settings** dialog over the
current organization page. The `appSettings` search parameter owns the selected
section; opening preserves the background path and search, section switches
replace that parameter, and closing removes only that parameter. The existing
standalone `/o/{orgSlug}/settings/*` routes remain available for direct links,
but normal utility, account-menu, command-menu, and review-history entries use
the dialog. Notification-settings Inbox sources open it over Inbox. An expand
control immediately before Close opens the active section's standalone route
from the same capability-filtered registry. It removes `appSettings`, keeps the
AI usage scope when expanding that section, and replaces the current history
entry.

Both presentations use `SettingsPage`, the same section registry, grouped
navigation, capability checks, and section components. The dialog reuses the
existing contextual sidebar item primitives, including icons and selected
states. `SettingsDialogContent` supplies the shared Space/App dialog shell;
App settings uses its larger 1024px by 42rem variant, constrained to the viewport.
Navigation and content scroll independently. Section components and their
mutations do not fork by presentation.

The dialog shell and section navigation mount once, including on a cold first
open. Heavy section panels load lazily inside the content area; loading must
not replace the dialog or its navigation. Unavailable dialog sections recover
to Account through the same capability-filtered registry.

The Settings secondary sidebar always shows these two groups:

- **Personal** — **Account**, **Appearance**, **Notifications**, **Spaces**, **Privacy &
  Safety**, and **Send feedback**. In a Personal Workspace, it also includes
  **Center Agent** (placed after Privacy & Safety, before Send feedback).
  Account preferences do not change when the selected Organization changes.
  Privacy & Safety also shows **Agent creation permissions** for the signed-in
  member in the current Organization, explicitly naming that scope. It links to **Center Agent →
  Memory** for the current workspace's member-memory erase action and lists the
  signed-in member's Computers for Computer file access. Both operations stay
  on their canonical product surfaces rather than creating duplicate settings
  state. Send feedback is an account-level utility action immediately after
  Privacy & Safety (or after Center Agent in a Personal Workspace). It opens
  the existing feedback dialog rather than creating a route or a second
  submission contract.
- **Current Organization name** — **General**, **Center Agent**, **AI usage**, **Members**,
  **Invitations**, and **Security**. General owns identity and lifecycle, Center
  Agent owns coordinator identity, connection, model, and audit history,
  Members owns roles, Invitations owns requests and invitation delivery, and
  Security owns information protection. Security is visible only to owners and
  admins. AI usage owns organization consumption and the signed-in member's Remote
  Agent view. A personal workspace shows General and AI usage: organization membership
  and invitation management do not apply there, and its coordinator belongs to
  Personal. The visible group label is the selected
  Organization's stored name, including for the personal Organization; it is
  never the generic label `Workspace`. Every member can see these surfaces;
  each mutation is shown and enforced according to the member's role. The group
  label shows only its name and collapse control, without organization or role
  badges. Roles remain visible in Members.

Invitation review lives at `/o/{orgSlug}/inbox?requestId={id}`. Open invitation
items expose source-owned approval controls directly in the full Inbox list.
Email and legacy Settings links reach the same Inbox detail; the applicant
status surface stays separate. Pending decisions appear under **Needs review**.
Approved incomplete invitations appear under **Needs action**, with a recovery
action rather than another decision. Visibility follows current source permission.

Settings → Invitations retains invite controls and one **Invitation records**
table, reusing `@openmeld/ui/components/table`. Its five columns are recipient,
decision, reviewer, invitation status, and actions. Requests and native invitations
are grouped by recipient, preserving every source record without inventing a
request-to-invitation ID association. Repeat requests retain separate decision
rows; invitation status belongs to the recipient group. Direct invitations also
appear in this table. Status is concise, review dates omit the time of day, and
exact timestamps remain in request details and date titles. Approve, decline,
and cancel use visible buttons in the actions column; unavailable actions show
a dash. Current admins share the same
records; ordinary members see their own requests. Pending requests sort first,
including across pages, with direct approve/decline controls for current admins.
Inbox remains the primary review destination. Both surfaces reuse the same
source mutation and invalidate the same Inbox and request queries. Pagination
uses the pending group, created time, and id. Settings has no invitation attention badge.
The avatar's Invite people dialog continues to reuse the invitation controls.
Approval, delivery, and membership remain separate facts. Decisions and retries
refresh shared request, invitation, and Inbox projections.

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

Appearance's **Animate Bot avatars** switch is enabled by default and uses one
browser-local preference across Organizations and all Bot avatar entrances.
Turning it off stops working animation, click interaction, pointer following,
and editor previews immediately. The shared Bot primitive combines this setting
with the operating system's reduced-motion preference; enabling the switch
does not override reduced motion. Navigation or selection actions on an avatar
remain available independently of animation.

Appearance's **Sidebar** group offers **Icons and text** and **Icons only**
preview cards for the outer app rail. The rail's **Show** context menu changes
the same `openmeld.appearance.sidebar-display` preference. Web restores its
document-root CSS projection before paint and synchronizes changes across
tabs. Both presentations reuse the existing Fluid menu rows. Icons only uses
the shared 52px Fluid icon width, giving the work area 24px more room while
preserving navigation destinations and the inner sidebar's width. Narrow
screen drawers always show full labels.

### Product context menus

Right-click entry points reuse `@openmeld/ui/fluid/context-menu` and the same
action owners as ordinary menus. They do not introduce a second preference,
permission, confirmation, or mutation path:

| Surface | Actions |
| --- | --- |
| Primary rail destinations | Open and copy link; empty rail retains the display menu |
| Conversation sidebar and directory rows | Open, copy link, pin/unpin, move; rename/archive when offered by the existing owner |
| Conversation sidebar empty area | New message and new Space |
| Space and thread messages | Existing reactions, copy, reply, pin, task, details, edit and recall actions, with their original eligibility |
| Inbox items and groups | Open/copy source link, read/unread, remove; groups retain their exact snapshot and confirmation boundary |
| Team people | Open/copy profile link, message, star/unstar using the same sidebar preferences |
| Agent cards and workspace header | Existing details, editing, messaging, Project/folder, unbind and removal actions; opening either menu refreshes eligibility |
| Plugin and Skill catalog cards | Open and copy the exact detail destination |
| Skill detail header | Existing copy, usage, properties, history, maintainers, enable/disable and removal operations |
| Team and Space file browsers | Existing create, open/download, rename, move/copy, pin, trash/restore actions appropriate to the location and permissions |
| Knowledge folder/document cards | Open/copy authorized navigation links and existing management menus |

`copyAppLink` resolves relative destinations against Web's current origin or
Desktop's declared public Web origin, never the packaged renderer origin.
OpenMeld currently has no general resource deep-link protocol. Do not invent
one or expose a private download URL as a share link. Knowledge document links
retain normal access checks; files without a public navigation link retain
their existing download/copy operations. Editors and selected text retain
native menus; progress-only message rows do not create empty custom menus.

Personal Spaces settings owns the browser-local **Your messages** placement used by
every Space, Direct Message, Center Agent, and thread conversation that
renders the shared message primitives. A message placed on the right uses a
trailing-aligned, content-sized bubble; a message placed on the left uses the
available transcript width beside its avatar. In the Full width conversation
layout, a short main-timeline message fits its content, while a long one can
use the full available width without a separate bubble cap. Centered layout
limits the conversation column itself.
Both placements keep their content leading-aligned. Ordinary Spaces put the
speaker's avatar beside the name and bubble, with the name aligned to the avatar's
top and the bubble below it. Names use regular-weight, muted, extra-small text;
the name line compensates for the font's ascent inset to align its visible ink
slightly above the avatar top.
Speaker avatars use the transcript viewport's available width: 24px below 640px,
28px from 640px, and 32px from 1024px. Their column keeps an 8px gap before the
message content, including grouped messages and either self-message placement.
Narrow Threads keep the compact size even on a wide desktop. Human, Agent,
system, and pending first-message avatars share this presentation; inline
mentions, reaction lists, profile popovers, and sidebar sizes are independent.
An Agent avatar without an image, Fluid art, or a Bot draws its controller or
model logo on the same raised tile as the Harness logo (one shared surface
class); human avatars keep their own style.
Direct Messages, including Center
Agent chats, use content-sized bubbles up to the available conversation width
with a dedicated avatar column. The first
message in a speaker run aligns the avatar with the bubble's top; subsequent
messages retain the same column. Names and runtime/owner attribution are omitted
from DM speaker headers, while avatar Profile Details remain available. The
current member's avatar follows the same left/right Appearance preference as
their bubble. Main timeline, threads, and pending first messages share the
speaker and alignment primitives. The main timeline groups consecutive messages
and floats actions beside or above a bubble without shifting the transcript.
A Thread shows each message with its own speaker header. Its bubble can use the
panel width, and its actions occupy a reserved row below the bubble instead of
reducing the message width.
Every speaker's message uses
the same semantic radius and content inset. Other speakers use a quiet muted
surface; the current member uses a soft tint of the shared blue `unread` color,
with theme-specific opacity. Message boundaries remain visible in either theme.
With right placement, the full transcript row stays
available as the hover and focus target, while the visible current-member
surface and its actions stay anchored to the bounded bubble. With left
placement, that surface remains full width. Agent and other-member messages
keep their existing leading alignment and full-width layout. Product
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

**Settings → Center Agent** owns Center Agent configuration. It lives in the
global App Settings destination (grouped under the current Organization's name,
or under **Personal** in a Personal Workspace) at `/o/{orgSlug}/settings/center-agent`.
The historical `/o/{orgSlug}/center-agent/settings` path redirects here.
It contains Model, the Audit Log, and the reversible
Organization-wide operating control in **Danger Zone**. The initial read uses
the Directory's `centerAgentOnly=true` scope, which resolves runtime readiness
only for the designated Center Agent and omits the member directory. Model and
organization memory queries start in the settings owner before identity loads;
their sections share the same query caches. The Audit Log loads the existing
identity-only Profile Directory on demand for actor and resource names, without
requesting unrelated Agent runtime state. Scoped and full Directory caches stay
separate and share identity mutation invalidation. Retained settings data does
not change freshness or operating-control authorization.

Only the immutable
Organization creator may pause or resume the Center Agent; owner/admin roles do
not grant this authority. The active state presents **Pause Center Agent** and
requires a confirmation that pausing stops every current task across OpenMeld,
Slack, and connected Channels and rejects new tasks. The paused state presents
**Resume Center Agent** directly and never sends the user through setup or
reconnection. Pausing preserves identity, conversations, Routines, Channels,
Plugins, Bindings, and settings. Other members see why the control is unavailable.
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
model id. Owners and admins may choose **OpenMeld default** or a curated model
from OpenAI, Anthropic, Google, DeepSeek, xAI, or Z.ai and save through the
Binding-revision compare-and-set contract; members see the same effective
configuration without enabled mutation controls. The OpenMeld-default option
includes the current effective model so a future system-default change is
understandable without duplicating it into browser state. A model choice's
optional catalog-owned badge appears in both the closed selector and its
matching options; Web does not infer badges from model names or the current
default. The adjacent Reasoning effort selector offers only efforts supported
by the chosen hosted model and shows its catalog default.

The first-level **Provider** selector filters the second-level **Primary model**
picker. Provider means the model vendor, derived from the exact OpenRouter ID
prefix; it never changes the serving route or asks for another credential.
Known vendor prefixes have friendly labels; a newly cataloged prefix is shown
verbatim so an older Web build can still expose it. Options are derived only
from Core-projected choices, not from a separate browser model catalog.
Changing Provider clears an incompatible draft and disables Save until a model
is selected. It never selects a model automatically or persists the filter.
Provider state resets across Organizations.

**All providers** shows the curated list and retains the **OpenMeld default**
option. Both fields reuse Fluid Select through the Web-owned
`HostedModelSelect`; provider filtering replaces the separate searchable
Combobox so the small curated list uses one selection interaction and appearance.
The saved choice comes first, and a persistent current-model label remains
visible while browsing another provider. Selecting a candidate only changes the
local draft. The current label changes after the Binding save succeeds.

Personal Remote Agent creation and model editing reuse this same two-level
selector and hosted catalog. They store the explicitly selected model ID and
an optional supported reasoning effort. Center Agent settings use the same
reasoning selector. New personal Remote Agents initially select GPT-6 Sol with
`medium` effort; Center Agent OpenMeld default is Claude Opus 5.5 with `medium`.
Default reasoning follows the selected model's catalog effort.
An explicit effort under **OpenMeld default** saves the current default as a
concrete model selection. Before Save, Web explains that this model will remain
selected when OpenMeld defaults change; Core owns materializing the model ID.
Changing to another provider clears an incompatible draft and requires a new
model choice before Create or Save; an empty draft must not silently select
the system default. Local Agent model controls keep their controller-owned
models, compatibility checks, and reasoning choices.

Before saving a changed selection, inline copy explains that it affects new
turns across the workspace, including existing conversations, while admitted
work keeps its frozen route. Switching to a different model may rebuild the
prompt cache and increase next-turn input costs; this is a conditional cost
notice, not a price quote or a claim about provider cache receipts. This surface
does not add session pinning, live-turn switching, auxiliary overrides, or user
provider credentials. Hosted provider configuration remains OpenMeld-operated.

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

Team Computer links include both the owner account ID and device ID. A device
ID alone is not unique across accounts. Legacy device-only links resolve only
when the visible inventory has exactly one matching Computer; ambiguous links
ask the viewer to select the Computer from its owner's Profile. They must never
pick the first match or borrow another account's live status. Team detail
resolution waits for the initial Organization projection refresh before using
cached identity evidence. Stale local-agent checks display **Status out of date**:
current availability is unknown until the Computer reports a new check. This
does not mean that the Agent version is outdated or that repair is required.

Local Agent cards show quiet tokens-today text after the account usage ring only when the current
workspace has recorded positive token consumption for that controller on that
enrolled Computer. The existing Details dialog includes an OpenMeld usage
section with Today/Last 7 days, input/output totals, models, and an optional
top-task disclosure. Periods use the viewer's local calendar days. When only
the last seven days contain usage, Details starts there; periods without
recorded tokens are unavailable. No usage records or unsupported collection
produce no consumption copy, badge, placeholder, or reserved space. These
statistics remain separate from provider account Usage Limits and do not
present Local usage as free or as spending the organization allowance.
Owner and teammate views read the same organization-scoped consumption query.

Owned Computer Connection cards keep the current status, actions, and any last
update failure visible. Update records, software versions, connection history,
and saved connection reports share one default-collapsed **Technical details**
disclosure, with matching typography for the nested section controls. A newer
connection report does not erase a failed update or confirm installation.
Sleep prevention is one setting row without a separate Power heading; its
saved preference and default remain owned by the local Service.

Owned and teammate Computer details place Local agents before the compact Local
Agent token usage card, prioritizing agent availability and controls over usage
statistics. The usage card combines recorded Local Agent tokens on that enrolled Computer
in the current Organization. The default seven-day area chart uses calendar
days in the viewer's time zone, including today so far. Details contains the
7/30-day selector, refresh, and an accessible daily input/output/total table.
Each controller has an unstacked series, a labelled legend, and its existing
Local Agent icon in tooltips and table rows. Colors reuse the shared controller
brand accents; monochrome Cursor and OpenCode logos use fixed amber and teal
chart accents. Unknown attribution remains explicitly labelled. Daily controller
rows and curves use the same scoped time-series query.
Initial loading uses the shared Evil Charts skeleton; no recorded tokens hides
the card. Explicit missing-token receipts produce gaps instead of known-zero
points, and partial totals are disclosed in Details. No provider polling or
inference is performed to load the chart.

Each Local Agent renders its `usageLimits` list inside the existing expandable
row. Usage Limit evidence does not create a separate page or make the row expand
automatically. In the collapsed row, a compact summary follows the existing
version and update metadata. Single-provider controllers retain one compact
summary. A multi-provider controller shows at most three labelled provider
summary rings plus an overflow count; each ring uses that provider's most
constrained quantified window and never averages windows or providers. Its
tooltip previews every reported provider and window. Selecting the existing row
reveals one flat group per provider, with separate rings for every real quota
window and no nested provider or window cards. Providers without quantified
evidence share compact status rows instead of empty placeholder cards. Each
window keeps reset and last-observed times visible without a full-width progress
bar. Owned and teammate Computers use the same shared summary and accessible
gauge component.
A provider with no quantified evidence does not add a collapsed-row badge or
placeholder gauge. Web explicitly opts in to both owner and Organization
projections and refreshes them while People or a Computer detail is active.
A gauge names the limit, derives and exposes its 0–100 remaining value to
assistive technology, shows the remaining percentage in text, shows reset and
last-observed time, and names the state so color is never the only signal. The
UI derives **Low** when a fresh
available limit is at least 80% used; it does not store a second status or
remaining percentage. Unknown values have no gauge and never appear as 0%,
100%, or unlimited.

The UI keeps providers and their windows separate and handles offline Computers,
expired evidence, temporary provider failure, permanent lack of support, and a
supported provider that has never returned evidence. Last-known percentages on
an offline or expired Computer are **Stale**. A temporary first-read failure is
**Unavailable**; no native provider source is **Unsupported**. Copy states that
OpenMeld checks supported current limits before starting new work. Exhausted or
unavailable evidence from an unselected nested provider does not affect the
current Agent Profile's Wakeability.

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
an **Installation** control when the live Service advertises both installation
management and idle-selection safety. It is a compact, borderless section above
**Usage limits**, separate from the diagnostic list; **Launch check** remains a
plain diagnostic row. The control names the selected source and version, and the
collapsed row names the same source beside the version so people never need to
infer an installation from a version number. A selector lists only locally
verified choices and stages a new choice without changing it. A quiet inline
confirmation then names the exact target and requires an explicit **Switch
installation** action. It never opens a nested dialog or renders each choice as
another card.

The Service-owned selection status disables the selector while matching work is
queued or running and explains: the agent has work in progress, so the person
must wait until it finishes. A concurrent installation operation gets a separate
short-lived message. One verified installation is read-only only when it is the
current selection. If the saved selection is gone, the sole verified alternative
still has an explicit switch action. Installation controls never depend on the
inventory's candidate count: the live installation response owns the available
choices and selected identity. Launch check describes launch readiness only;
installation identity and choices belong in the Installation section. Loading, empty,
failure, switching, and slow-reconciliation states remain inline without moving
the surrounding dialog. Long names and details truncate within the selector,
the control never blocks setup, and it never appears for another member's
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

**Settings → AI usage** is a read-only destination available to every active member.
Its text-only navigation matches the other Settings items. Fluid **Organization usage /
My agents** tabs share the current Organization scope. Organization usage shows recorded
Center Agent and Remote Agent costs by model, separately recorded Local Agent
tokens. Routine counts and limits do not appear here; this destination covers
AI consumption only. The existing `usage` route remains unchanged. My agents selects the
signed-in member's non-Center Agent Profiles from the organization directory and
shows their Remote runtime costs and Local Agent tokens; it is a subset of organization usage,
not another allowance. Empty ownership selects no receipts.

Both cost views reuse the shared chart, model brand icons, and Fluid controls.
They start at seven local calendar days, with a 30-day selector, refresh, model
totals, and personal Agent totals in Details. Costs carry a green **Free** badge;
provider estimates and missing costs are not presented as invoiced charges.
Local token charts reuse the Computer chart without a Computer filter and remain
separate from costs. My agents applies the same owned-profile filter to both charts.
A daily allowance appears only when explicitly configured,
with the existing UTC reset. No billing controls, export, or task drilldown is
introduced. These views read the existing Web → Gateway → Core projections.

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

For a non-personal Organization, **Settings → Security → Information
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

The ordered steps are Organization, Channels, Plugins, this computer, defaults,
invite, and ready. Detailed product semantics live in
`developing/product/onboarding.md`. Web-specific boundaries are:

- pending email invitations use Better Auth's current-user invitation list and
  existing acceptance mutation;
- Organization join flows update route-scope caches optimistically without
  writing Better Auth active-Organization session state. Creation waits for the
  Auth-generated slug because Web cannot invent a truthful provisional URL;
- Slack, Lark/Feishu, Plugins, connector requests, Prepare, memory,
  Organization documents, Information Protection, and invitations reuse their
  existing query keys and mutations;
- role-gated sections do not mount unauthorized reads;
- mutations update the owning cache first and restore the exact prior value on
  failure; server-generated invite-link tokens remain pending until Auth returns
  the real URL;
- the result screen is assembled from confirmed memory-policy, Channel, App,
  local-runtime, local-agent, and invitation projections.

The former blocking `OrganizationEntryOnboardingDialog`, its two steps, local
hook, and tests are removed. Organization memory is no longer a separate
consent corridor: its untouched value defaults on in Setup Studio, explicit
prior choices remain authoritative, and the same setting remains available in
its normal management home. Agent Profile Organization ownership has no
preference or onboarding surface.

### Retired and relocated surfaces

**Directory** is retired as a user-facing container. Its People and Agent
Profile leaves live under **Team**, with Agents nested under their owners. The
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
the user to a different feature home. Organization-only Settings management leaves
(Members, Invitations, and Security) are the bounded exception: personal workspaces
have no team membership to manage, and direct links explain that scope rather than
redirecting to an unrelated feature.

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
   sidebar; keep Routines, Skills, and Channels in the conversation header;
   keep Memory and Center Agent settings in the header menu; and
   retire the redundant About surface and Slack shortcut.

Team Skills supersedes W-NAV6's Skills placement: the catalog and detail now
belong to Team, with legacy Center Agent Skills URLs retained only as redirects.
The current header also supersedes W-NAV6's compact Memory placement by making
Memory a first-class tab after Channels.

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
- Wakeability and reply-recovery presentation
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
informed move. Web does not migrate Personal Spaces, Plugins, Agent Profiles, or
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

The selected entry fixes the provider. Setup copy asks for that provider's
account; returned links must pass the shared-issuer/selected-provider schema.
Web changes only the validated link's host to the selected platform for the
browser. Shared-issuer HTTP URLs keep old Gateway and Web readers compatible,
and new Web also handles old Core without a registration restart. A detected
brand mismatch names the selected and returned brands and offers Start over
after switching accounts. It must not silently change the selected provider or
keep presenting a brand mismatch as approval still pending.

If initial begin/resume fails before a registration can be displayed, the
dialog preserves the error and offers managers an explicit Start over action.
The action keeps the selected provider and uses the existing authorized restart
mode. It never automatically retries a corrupt or unreadable registration.

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
When configuration requires additional setup permission, the dialog explicitly
offers **Reauthorize Feishu** or **Reauthorize Lark**, which opens official
consent for the existing app with the updated setup permission bundle. It does
not send the user to Developer Console to edit permissions manually. Core
retains its bounded retries and verifies configuration after consent.
The Channel card must show **Authorization required** and **Review authorization**
for this reason, rather than implying that passive waiting will finish setup.
Non-managers see that a manager must approve it. The dialog explains the scope
and offers **I've authorized, check again** using the existing poll action;
the click itself is not proof of consent or connection. New setup links include
the configuration scope in the provider's initial consent page, and the Web
introduction discloses message and app-configuration permissions together.
Managers can cancel an unfinished setup even when another manager started it;
cancellation retires its Core-owned attempt and prevents late polls from
reviving it. Expired attempts do not keep the Channel card in Connecting.

The Lark and Feishu cards are enabled in local and production configuration
for every Organization. Staging keeps both providers disabled.
Availability means the user may start setup; the card becomes connected only
after Core verifies that connection's application configuration, Event
Subscription URL, and Message Card Request URL. Setup availability does not
prove live provider delivery. A failed Feishu mainland reachability check must
produce honest failure copy rather than
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
Organization has independent members, Spaces, Plugins, and agent context. The
message is intentionally deferred until Center Agent member research has
produced both the provisional Profile Report and its real private Computer
file. **See what I learned** deep-links to that exact Organization Document.
**Invite teammates** and **Introduce me in channels** continue natively in
Slack; Web remains the complete People and Plugins management surface rather than
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

**Plugins** is separate from
Channels because Plugins grant scoped tool access rather than a conversation
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
The Plugins page title and description are the Catalog's only visible introduction.
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
truth used by other OAuth Plugins; it does not infer success from the redirect.
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
public OAuth Plugins, Web does not promise project access for a new OAuth
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
their own connection under Plugins. Organization owners and admins
manage shared Organization access on the same page; regular members see shared
status read-only. Disconnect opens a modal confirmation before any mutation.
The modal explains that the operation removes this OpenMeld Organization's
connection but does not sign the user out of GitHub or uninstall the OpenMeld
GitHub App. Web never reads the provider
credential, trusts the executor's global connection list as ownership, or
renders the legacy `github:default` connection.

### Center Agent memory controls

In a multi-member Organization, **Center Agent → Memory** owns the current
member's action to erase the Center Agent's memory of them. Ongoing shared
Organization-memory policy management lives with the other Organization-owned
controls under **Settings → Center Agent**. **Settings → Personal → Privacy &
Safety** links to the member-facing Memory page instead of owning a second
mutation surface.

Setup Studio presents the Core-owned default as enabled without writing a
synthetic user choice. It does not become a second management surface. An owner
or admin may turn Organization memory on or off under **Settings → Center
Agent**; other members see the policy read-only. Web submits intent through
the shared HTTP contracts and then refetches Core-owned policy; a browser toggle
or cached value is never memory policy truth.

Copy must keep the two scopes explicit. Wiping member memory does not delete
messages, Spaces, or Organization memory. Organization memory is on by default,
and its concise control explains that useful details from shared Spaces and
connected Channels may be used while private Center Agent DMs are not included.
Personal Workspaces keep both controls on the Memory page because Workspace
memory remains useful across Spaces and connected Channels, and the person
still needs transparent controls to turn it off or erase their separate member
memory.

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

People and Human Profile popovers read the lightweight Profile Directory with
`includeModelSelection=true` for member identity and member-visible Agent
Controller/model configuration. They do not request the Agent Runtime Overview
to render these cards. An omitted model selection is unknown, not the default
model; null with a Controller means its default model, while no Controller and
null model selection mean no primary Binding. Binding changes invalidate the
lightweight directory through the existing readiness refresh path, including
cross-tab invalidations. These are configured values, not evidence that an Agent
can Wake or that a particular model executed work. Agent pages retain their
Core-owned runtime overview and Wakeability checks.

Entering People starts the Profile Directory and personal sidebar-preference
reads as early as route intent allows, without holding navigation for either
response. Known member rows and Team cards remain visible while personal
sidebar preferences load; until those preferences arrive, the list uses its
default Human-presence sections and saved-group actions stay unavailable. The
same early reads apply to member details, Agents, and Agent details; Agent
runtime availability remains a separate current read. Space member popovers
also stop presenting an expired Computer connection as current. The
account-and-Organization-scoped browser read cache may restore sidebar layout,
then refresh it through the existing revisioned server read. It does not persist
the Profile Directory's mixed identity, activity, and Agent configuration
response. Human presence, Computer state, and Agent runtime/usage projections
retain their separate current-read and unknown-state rules; saved layout never
supplies those facts.

Last-seen time comes only from the Core-owned, Organization-scoped Human activity
projection. Web explicitly reports entry, return to the foreground, and a
bounded actual-interaction report; Core re-verifies the active member and that
member's current active Human Profile before advancing the projection. CLI use,
Auth session refreshes, Computer heartbeats, and Agent Activity are not
substitutes. Undefined activity is omitted instead of rendering a placeholder,
and relative last-seen text never claims live online presence.

The same foreground reporter includes the current Space when visiting a Space
route. Core records both scopes from one server timestamp. Hidden tabs and
socket reconnects do not count as visits. Directory reads refresh on foreground
return and every five visible minutes; Space member elapsed-time labels are
formatted from `lastSeenAt` against the current clock, never a cached label.

The People sidebar contains Human Profiles. Starred and user-defined groups
precede **Online** and **Offline**, based only on Core's Human presence projection.
Unknown presence stays in an unclassified **People** group. Computer connection
remains an independent filter in both the Team toolbar and each section. Both
surfaces use **Computer connected** and **Computer disconnected**; Online and
Offline refer only to Humans. Toolbar filters apply across sections and combine
with the selected Human groups and per-section filters. The designated Center Agent lives in the Agents
directory, outside Human presence counts. The signed-in member follows
ordinary placement unless a saved star or custom group applies. The signed-in
member always appears first within that group, regardless of sort or manual order;
the remaining members retain the selected ordering. Explicit
unstar and custom placement persist; deleting a group returns its members to
ordinary placement. Online requires an unexpired Core presence lease with Human
interaction within five minutes. Any active page keeps the Human Online. Computer connections,
Agent work, and historical activity never establish Human presence.
Rows show the avatar, name, Computer status icon, Human last-seen
time when known, and enabled local-agent icons. Computer explanations remain in
the icon tooltip and accessible name; Channel identities and email are omitted.
Pending Computer checks stay on their rows without delaying Human grouping. Sorting and drag placement
remain personal preferences; dragging cannot change Human presence.
People keeps its last successful Computer and Local Agent display in the
Organization-scoped in-memory query cache for up to one day after leaving Team.
An expired query refreshes on return or through the visible 30-second poll
without clearing that display; a failed read shows unavailable Computer status
while retaining the last known Agent logos as read-only context.
This Computer projection is not restored from IndexedDB.

People and Space member/profile avatars show a small inset green dot only when
the Human is Online. Offline and unknown states have no visible marker; accessible
Online, Offline, or Online status unavailable labels remain available. One app-shell
reader refreshes the authorized batch every 30 visible seconds and on foreground
return. Failed or stale reads remain unknown. Active pages renew a 90-second lease
every 30 seconds; trusted pointer movement, clicks, keyboard, wheel and touch input
reset the five-minute idle limit. Brief focus or visibility loss pauses renewals
and lets the existing server lease expire naturally, instead of immediately
declaring the Human offline. Space navigation preserves the Organization session;
page departure and account/Organization exit end only that page's lease. Historical Web
activity advances only on actual interaction, with its existing five-minute
throttle; presence renewals do not advance it. Space-local Here … ago remains a
separate historical fact. No system-wide activity or interaction contents are collected.

Human cards combine enabled Local Agent logos and provider Usage in one compact, overlapping
dock. Each controller appears once. A small ring overlays the logo's upper-right
corner when the existing authorized Computer projection has quantified evidence;
otherwise only the logo appears. The ring previews the first reported Computer/provider
source, using the existing most-constrained-window summary. Additional sources
appear only in the tooltip, never as an averaged or pooled quota. Hover previews every
Computer, provider and window with remaining capacity, status, reset and observation
times through the shared Computer Usage components. The compact sidebar logo strip
keeps its existing sizing. This preview does not add permissions, collection or Wake policy.

Agent Profile detail pages and Space profile previews read the same team-visible
Computer Usage projection, matched to the Profile's current route Computer,
owner, and controller. They never borrow a quota from another Computer or infer
Wakeability from it. Human card docks align to the card's vertical center.
Usage tooltips share compact remaining-capacity rings: up to three columns on
wide screens and one column on narrow screens, with separate Computer/provider
groups, reset times, and explicit non-available states. Stale evidence retains
its observation time. Local presentation fixtures enter through the shared
Computer reader so card previews and detail routes show the same evidence.

Team opens a compact member overview at `/o/:orgSlug/people`, with the same
grouping and ordering as its sidebar. The overview and sidebar share the member
member presentation data and personal preferences. The overview uses Fluid Card
groups with persistent card surfaces and 56px avatars; sidebar rows keep their
compact avatar sizes. Sidebar member rows omit activity timestamps and place
local agents on a second row aligned with the name, with a 6px row gap, leaving the name row for hover
actions; cards retain activity timestamps.
Sidebar groups start collapsed, using
the same disclosure behavior as Spaces. Entering a person opens their group for
that visit; explicit expand/collapse choices are remembered per viewer and
Organization independently of Spaces. The overview remains expanded.
The overview uses the shared window header with People (default) and Agents tabs and the
existing permission-gated invitation dialog. Its directory toolbar shows member
counts, name search, and group filters with the same gutters as Spaces.
Shared window headers and Team/Spaces directory content use
`--app-page-inline-padding` (24px below the desktop breakpoint, 32px above).
Files and Routines also share `--app-page-block-padding` (20px) and the shared
`PageToolbar` row, keeping their secondary tabs at the same position when
switching pages. File view choices use the corresponding grid, bulleted list,
columns, and gallery icons; the full toolbar and compact selector share the
same option definitions.
Conversation headers inherit this gutter rather than overriding it with the
separate message-content padding token.
Saved stars remain intact; historical
saved preferences have no provenance marker, so Web must not guess which saved
stars were automatic. An absent preference never creates a self star.
The Human Profile page omits the entire Advanced details section, including
Profile ID and copying it; underlying identity and diagnostic contracts remain.

The Agents tab at `/o/:orgSlug/agents` starts with the Organization's actual name
and its designated Center Agent, which opens the canonical Center Agent chat.
Human groups show the person's avatar and name. The viewer's group comes first,
then other groups by their most recent Agent task activity, with creation time
and stable identity as tie-breakers. Search matches people and Agents.
Personal full lists and Team groups reuse the same cards and list controls.
Center Agent and ordinary Agent lists share the Agent card presentation: a
96px action area, 56px avatar, persistent card background, and readable name.
Only the Center Agent supplies the upper-right role badge. Team and personal
Agent lists use the People page's full-width gutters and responsive card grid.
People and Agent lists share a compact search control that expands on demand.
Agent view options live in an icon menu. Per-group tools appear on hover or
keyboard focus and stay visible while their menu is open; touch users always
see them. People groups also offer local Computer-status filters. Agent owner
headers reuse the Human Profile avatar renderer, including its generated avatar.
Filters support multiple selections: OR within a facet, AND across Agent type,
Controller, and model. Local and Remote are the first filter choices. Controller
choices show their brand marks; model choices show recognized model-vendor marks
and names without inferring an unknown model's vendor. Search matches Agent and
owner names, Controllers, model names/IDs, and recognized vendors. Each Human
group has its own expanding search control.
Each filter and non-default sort/group choice has a removable chip beside the
controls. The settings menu has a visible secondary Reset button that restores
the page defaults, or the inherited page settings for one Human group. Menus
are bounded by the available viewport height and scroll internally.
Page filters apply across groups; a group's controls further narrow its list.
Optional Controller or model subgroups preserve the outer person grouping.
Each person's group has a chevron beside its settings control. Collapsing hides
the cards and list controls while retaining the person's header and an always
visible expand button. Search, filters, and sorting survive collapse; collapsing
exits selection mode and clears selected Agents. Groups start expanded and keep
their independent collapsed state while mounted.

Recent ordering uses the newer of creation and task activity from the existing
30-day Wake evidence window. Generic profile edits and last-used timestamps do
not count as work. The personal detail preview uses the same default ordering.
Task activity is a Core read projection over authorized profile IDs in the
RuntimeCoordinator and native delivery ledgers, not a new execution authority.
Web opts in with `includeTaskActivity=true`; old callers receive the unchanged
runtime overview shape. Missing activity uses creation order with an explicit
notice. Foreground runtime overview refreshes every 30 seconds.
Agent creation history remains a recovery/history surface. A single secondary
Creation history entry sits beside the viewer's name, or in the personal list
header. Its attention count includes failed setup, pending approval, and
completed creation with unfinished local setup; work already being created does
not imply user action. History supports result/type filters and search, with a
Needs attention shortcut and an explicit reset.

Owners can enter Select mode for their ordinary Agents, select individual cards
or the currently visible results, and delete them after one confirmation listing
the exact names and count. Filtering never adds hidden Agents to a deletion.
Other members' Agents and managed profiles have no batch-delete affordance.
Each deletion uses the existing owner-checked Auth endpoint and reconciliation.
Successful deletions leave the lists; per-Agent failures remain visible for
retry. No batch-wide rollback restores already deleted profiles. Existing
messages remain in history, and the confirmation states that deletion cannot
be undone.

Selecting a Human Profile sidebar item replaces the main content without
opening a right drawer. The route preserves the selected `profileId`, so reload,
back, and forward navigation return to the same person. The persistent detail
hero presents the member email and join time as one muted metadata line, while
the Organization role remains in the badge beside the member name. The detail
owns an **Agents** section whose header keeps **Manage Agents** for the signed-in
member and **All Agents** for other people at the trailing
edge. Every ordinary Agent appears as a compact card with its avatar, name, and
permission-scoped Controller and model summary when known. Cards stay in one
horizontal row and the row scrolls inline when it overflows; selecting a card
opens that exact Agent, while the section header link opens that person's full
Agent list. The detail also owns Computers, Connected Channels,
shared Profile details, and the permitted Profile Report, Learn about,
**Chat with {member}**, inline edit, connect, or manage actions. **Chat with
{member}** is the primary action and keeps the same compact button height as
adjacent actions. It does not repeat those account facts in a separate
member-account section. Header metadata, Channel-account, Profile, and
detail values are
text-selectable. Editing remains available only
for the signed-in member's own active default Human Profile. The sidebar and
detail omit the internal Handle, undefined recent activity, and the ubiquitous
**Active** state; only an exceptional disabled state is visible. Web does not
derive an Organization online dot from last-used time, Computer state, or
Space-scoped presence. Members without an active Human Profile do not receive
a **Chat with** or edit action, but their detail remains available for inspecting
account details and the explicit unavailable or disabled profile state. The
signed-in member does not receive a **Chat with** action for themself.
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

Team is one flat primary destination opening the People directory. Person details
use `/o/:orgSlug/people/:personId`; their Agent list lives at
`/o/:orgSlug/people/:personId/agents`, and a selected Agent lives at its
`:agentId` child route. Both Agent pages retain Team as the selected destination.
The list shows only that person's Agents, reuses the existing Agent card, and has
an explicit back link to the person. Agent details reuse the existing detail
surface and return to the person's list. Unknown or mismatched Agent IDs never
select a different Agent. The list keeps search and availability filtering;
owner grouping and the standalone Agent sidebar are removed.
The list header exposes **Create Agent** for the signed-in member and
**Creation history** in Organization contexts. The history uses the shared Fluid
table to show Agent, result, start date, and actions. Incomplete creation remains
recoverable against the same Profile. Errors briefly explain the failed step and
next action; raw diagnostics stay in the stored record. Cross-user requests and approval
remain held behind the shared launch policy. Web never creates a parallel
request state.

Agent configuration cards reuse Motion Primitives' Morphing Dialog shared-layout
mechanism to expand into centered dialogs. Base UI owns modal focus, dismissal,
and scroll locking; the shared primitive also serves Space image previews.
The closed Fluid cards, shared hover background, and open editor surfaces keep
their existing appearance. Reduced motion disables shared-layout travel.
The footer has one primary action: it opens the next required setting, such as
**Review permissions** or **Choose working folder**, then becomes **Create Agent**
when ready. A short hint explains the remaining step. Folder choices stay inside
the Working folder dialog. Folder pickers read the selected
Service session's advertised controls and send its exact device and lane.
Reconnect may follow a replacement device ID only within the same enrolled
physical computer; it must never silently move a draft to another computer.

**Create Agent** opens the full-width `/o/:orgSlug/new-agent` view so reload,
back, and forward preserve the user's location. Space, People, and other compact
entry points use the dialog composition. Both surfaces use the same creation
request contract. The global page first asks whether the Agent runs locally or
remotely. It opens a new Direct Message after setup without a destination
choice. Creation from the Space Members panel or Add People or Agents dialog
stays in that Space: the new Agent becomes selected in the picker, and the
member can add the selection to the Space. Local selection loads the existing
local creation generator; Remote
selection reads the hosted model catalog without loading Computer setup or
local Agent readiness. **Choose a Local Agent** always presents Codex, Claude
Code, Grok Build, OpenCode, Antigravity, and Cursor in that order. The complete catalog is
visible and selectable even when a Local Agent is not installed, is disabled,
is signed out, or has not finished checking. Selecting one is an inspection
choice; only the existing canonical eligibility projection can provide the
Binding choice used for creation. A concrete eligible local Agent and computer
are required before creation; there is no **Choose later** path.
Core rejects new Web creation requests without that target before creating an
identity. Existing request retries and intentional CLI manual profiles retain
their contracts. The single-page form places the editable generated Agent name
after local agent selection, followed by **Advanced Agent Settings**, expanded
by default. It submits directly with **Create Agent**; there is no review step or
duplicate selected-model summary card. One available Computer target is selected
automatically without showing a computer name, status, summary, or selector.
Only two or more available computers expose computer selection, using the
shared Fluid selector. Zero available computers also show no selector.
Offline, reconnect-required, unknown,
and update-blocked connections do not count as choices. Availability here uses
Core's live connection and compatibility projection, not historical execution
targets, and does not imply Agent Wakeability. Ambiguous live connections remain
explicit in advanced details; automatic selection never overrides a Session
preset or guesses between multiple connections on one Computer.
While local agents are loading, the heading
reports checking instead of prematurely asking the user to connect a computer.
The form keeps its actions separate through spacing without a footer divider.
An unavailable selected Local Agent renders one full-width dashed recovery
panel below the catalog. The panel names the concrete reason and offers the
Agent-specific install guide, an inline enable switch, concise sign-in/setup
guidance, or a retry as appropriate. It must not hide the choice or replace the
whole page with loading. An available selection shows its cached Usage summary
at the far right of the editable default-name row above Advanced Agent
Settings. Only that summary may show a skeleton while its already requested
runtime projection loads; the form remains interactive and Web does not issue
a duplicate provider Usage request.
An unfinished browser-local draft may prefill that first decision, but the first
new local-Agent or execution-target choice dismisses restoration for the current
open flow so later renders cannot reverse the user's click.
Creating for another Organization member remains the same Core-owned Agent
Profile Creation Request flow; Web does not introduce a simplified parallel
request model. The previous full-form dialog may remain as a temporary internal
legacy composition during migration, but new entry points must not fork its
creation contracts.

Agents reads the same lightweight Profile Directory first, renders Agent
identity immediately, and loads the Agent Runtime Overview independently.
Missing initial runtime evidence is shown as checking for the affected Agent;
a failed runtime refresh keeps the identity list and last successful runtime
projection instead of replacing the workspace with a page-level loading or
error state. Automatic readiness refresh invalidates only the runtime overview;
identity refresh remains tied to membership, Profile, designation, and Binding
summary changes.

After creation commits, Web refreshes the Profile Directory before navigating
to the new `profileId`. The existing page stays in its checking state while the
independent runtime overview catches up; it must not flash **Agent not found**
or reuse a stale unavailable verdict for the new identity.

`/agents` is the Team Agent directory. Legacy `/agents?profileId=...` and
`/agents/new` links redirect to the exact Agent child page and the creation page.
Agent request links resolve to `/people/agent-requests`.
Checking readiness and Wakeability never count as work activity. Each card shows the
Agent avatar, name, a compact Controller and friendly model summary when known,
and the existing Core-owned Wakeability projection. The summary resolves
Controller defaults through the shared Model Catalog and never substitutes a
raw model ID for the catalog display name. People Agent cards use the same
formatter. Route-online,
Binding existence, browser-local recovery state, and completed Prepare evidence
cannot substitute for that readiness. The selected `profileId` remains in the
route search contract so refresh, back, forward, and request-to-Agent navigation
open the exact same Agent.

The selected Agent’s right-hand detail uses the same Profile Details section
model, permissions, queries, mutations, execution-target locks, and diagnostic
facts as the existing About and edit surfaces. Read-only detail is the default.
Its existing **Current activity** section combines Space-owned Wake progress and
pending input across that Agent's Organization conversations. Owners and other
members see the same compact counts, for example **1 active · 3 queued**.
Each viewer sees source text and navigation only for conversations they can
access; other conversations contribute neutral counts. Owning an Agent alone
does not reveal its private conversations. A Work Coordinator slot is not proof
that the provider is generating. This read-only presentation does not add a
second execution queue or grant mutation access. Neither view infers work from
Agent Activity, browser timers, or message age.
If interrupted work needs attention, only the owner sees **Skip interrupted
work** in this Activity section. The action resolves the exact current recovery
gate and lets the oldest queued Wake continue; repeating it is harmless. Web
sends the projected interrupted-Wake identity with the action. If an older
projection omitted that identity, Web asks the owner to refresh instead of
sending an unfenced Skip. Web advertises directory work-recovery contract
version 2; Core omits Skip from callers that do not advertise that receiver
capability, including already-loaded older Web builds.
Non-owners see the same neutral workload summary without the interrupted source
or recovery action.
The **Current activity** section consumes the existing authorized workload
locations and task activity timestamp. It does not substitute the bound Local
Agent Session for the current Wake destination. Binding a controller
conversation is Runtime configuration, not evidence of current work.
The configuration grid keeps **Runtime** as
its final card and uses it to show the bound Computer and Conversation ID even
when that Session is idle.
**Chat with {Agent name}** is a primary header action. An authorized owner may choose
**Edit Agent** to edit in place, then explicitly **Save changes** or **Cancel**;
a failed save keeps the draft and its diagnostic visible. Dangerous or
low-frequency actions remain in the overflow menu. This presentation does not
create a second Agent Profile, Binding, readiness, request, or edit authority.
Each configuration card validates and submits only its visible fields. Unchanged
permission modes must not require renewed confirmation for unrelated edits;
selecting a dangerous permission mode or changing controllers still requires the
applicable confirmation. A non-editable permission capability is read-only.
Readiness-backed configuration reads collaboration mode from
`publicProfileConfiguration`; its compact `primaryBinding` omits that field.
Model, collaboration, and permission cards close on submission and show a
presentation-only optimistic value marked **Saving…**. The other model,
collaboration, and permission editors remain usable; writes to the same Binding wait for the current write
to settle. Failure restores the confirmed summary and preserves that card's
draft and error for retry. Only a matching server response means **Saved**.
Cache reads started before that response cannot overwrite it, and follow-up
status refreshes run in the background without holding the save open. These
optimistic summaries never grant permissions, change Wakeability, or become
Binding execution truth.
Agent identity controls in messages, Threads, and the Members panel open one
compact Profile Details popover. It shows the Agent identity, current
availability, and a primary **Chat with {Agent name}** action. The popover omits
configuration cards and gives the owner one persistent pencil action to open
the canonical Agent route; other viewers receive a right-arrow profile link. It
does not add a second details dialog or an overflow-menu details action. Owners
edit supported settings from the canonical route; other viewers keep the
popover read-only. Agent cards, profile pages, mention picker rows, and composed
Agent mentions share the Core-projected provider Usage Limits, including remaining
percentages, reset times, and stale or unknown evidence. The picker places the
usage preview after the availability indicator. Selecting a composed profile name
opens the same Profile Details popover used by messages without changing the draft
or its Wake relation. Usage display does not derive or override Wakeability.
Both owner and observer popovers show the same compact activity summary and
recorded `lastTaskActivityAt` when supplied by the runtime overview. Location
links appear only when Core disclosed them. The timestamp is historical task
evidence, not a live heartbeat, presence, or model progress; its tooltip gives
the exact local date and time. Reads reuse the existing organization query and
only mount with the visible surface. Agent conversations marks a Space with a
current task and labels its message timestamp **Last message**. Session-writer
conflicts say **Waiting for {Agent name}'s session**, never that another turn
must still be running. The writer ownership and recovery mechanism is unchanged.
Web must not maintain a separate About-versus-Edit presentation or mutation
path. Disruptive Controller and working-folder changes keep the account-wide
execution lock and Core writer guard described below.

The person's Agent list uses one column on narrow screens and two columns when
space permits. It has no secondary-sidebar drawer. Loading, failure,
filtered-empty, and true-empty states remain distinct; the owner's empty state
keeps **Create Agent** reachable and another person's empty state stays read-only.

### Projects

**Projects** is the first-level home for the current Organization's durable
work Projects, including non-code work. Its canonical routes are `/o/{orgSlug}/projects` and
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
For a same-owner, same-Organization conflict, an updated Service also offers
**Connect to both Projects** with a separate share token. The dialog explains
that the original Project connection remains, current-folder writes share one
local conflict boundary, and ambiguous Session attribution needs attention.
Cross-Organization conflicts never offer sharing. Project detail lets the
owner choose one associated repository when connecting a folder; Core checks
that selection against current Project settings before the Service verifies
the local Git fingerprint.

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
Project detail reads independent versioned sections for repository associations
and one optional default code repository, the default GitHub or Linear issue
destination, and Common Agents. Each manager edit uses its section revision;
the page does not treat a saved preference as provider permission, Space
membership, or a connected local folder. The current-computer section retains
its owner-self connection status and authority.
The Common Agents editor keeps unavailable saved selections visible with a
Remove action, even when no active Agent choices remain. Removing a selection
changes only this preference and cannot grant access or reactivate a Profile.
The same continuous page shows up to twenty recent, viewer-authorized Task
links back to their owning Spaces. Core rechecks current Space access and Task
association before returning titles or phases; Web shows no private-Space
counts and does not call a bounded recent list complete history. An unavailable
read displays an error rather than an empty Task claim.

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

**Routines** in the primary rail at `/o/{orgSlug}/routines` owns personal and Team management
for Center, Remote, and Local Agents. Legacy Center URLs redirect with the exact
Routine/Run selection. There is one page, editor, API/query owner, and Fluid Table.
Personal and Team tabs filter authorized server results. The empty view uses a
centered shared dashed AppEmptyState; no recommendation or Self-Evolution setup
card is shown.

Web requests `contract=routines-v3` for management and `practical-v2` for mutations
and history. Core supplies visibility, executor choices, authority, schedules,
and eligible destinations. Web does not infer permissions from a Space directory.
The creator can manage personal Routines; Team readers need destination access.
Admins cannot edit or resume another user's explicit Agent with that user's
authority, but can pause or delete readable Team work.

The compact editor uses shared Fluid selects, a searchable Space picker inside
Fluid ScrollArea, Calendar for one-time dates, and Advanced for name/timezone.
Short values and chevrons stay together at the right edge. Private destinations
name the actual Agent and explain existing-chat reuse or creation on save.
Opening the editor never creates a chat. A personal Routine targeting a shared
Space explains that Space members can see its results.

Edits send only changed fields. They preserve schedules, exhausted one-time
state, hidden capability grants, and connected-conversation destinations.
Schedules and result destinations are explicit. An unavailable target needs a
valid replacement; it is never silently substituted. Query caches are interaction
aids and are invalidated after mutations. Active Run history refreshes while
claimed/submitted, using the owner's status rather than a client timer outcome.

Deleting stops future scheduling and retains permitted Run history. Pause does
not cancel an active Run. Local Agent selection explains that its computer must
be awake and connected. No Center Agent proxy is used for local execution.
The complete contract is in `developing/product/routines.md`.

### Desk first paint

The deferred proposal for replacing the current aggregate Space bootstrap with
a bounded, versioned entry read model is tracked in
`developing/clients/open-space-conversation-plan.md`. That plan is not current
production behavior and does not authorize implementation before its trigger
and consumer-inventory gates are satisfied.

The Organization index renders Desk at `/o/{orgSlug}` after its
route guard confirms current Organization access.
Ordinary Organization selection, creation, invitation acceptance, and
onboarding completion all use this same default path. An explicit intent, such
as continuing Slack installation, may still enter its named destination
directly.

The Center Agent pathless route branch renders Desk without the Center Agent
conversation layout. Explicit Center Agent capability routes retain their
existing layout. That branch owns its pending component; the global router does
not infer Center Agent pending UI from a pathname. The outer rail derives its
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

Space route shells, pending conversation history (including public Spaces), and
Center Agent use the Web-owned `SpaceConversationSkeleton` for message
placeholders. It reuses the shared Skeleton primitive with avatar and text-line
geometry and respects reduced motion. Each caller retains its own header,
composer, content rail, and loading truth; the skeleton owns no fetching,
permissions, or message state. Do not add separate full-width block placeholders.

Intent preload warms the same TanStack Query keys consumed by the target page:
account Profiles plus the Organization Directory for Agent Profiles, account Profiles
plus the Organization Space Directory for Spaces, and the current Space display
snapshot, history, entry resolution, and bootstrap for a confirmed human profile. Conversation
preload restores the bounded Dexie display snapshot and recent history before
prefetching the current server reads, so a saved conversation can render immediately
without racing browser hydration. After restoration, entry resolution runs alongside
bootstrap or contiguous history updates. It uses the gate's exact Space, acting
Profile, message, and Thread target Query key; a fresh server decision can be reused
on click even without a persisted display snapshot. Bootstrap does not fabricate
an access decision or seed a second authorization cache. Entry decisions remain
memory-only, use the existing 30-second freshness window, and are cleared at the
account authentication boundary. Membership and metadata live changes invalidate
entry resolution; runtime readiness changes do not. Every server content read
and action still rechecks permissions. Links from
the Space Directory carry
the already selected human profile so the Space bootstrap can start during
intent preload instead of waiting for a second profile-resolution navigation.
Space and Direct Message sidebar rows are Router links. The Router's shared
50 ms intent delay avoids warming rows that the member only passes over and
invokes the target route loader for pointer or keyboard intent. The exact acting
Human Profile stays in the target URL, so the loader restores and warms the same
conversation Query keys used on navigation. Every server read keeps the normal
authenticated and authorized API boundary, and leaving before the Router's
intent delay cancels the pending preload. Web does not maintain a second timer,
prefetch controller, or component-owned conversation-data path beside the route
loader.
TanStack Query is the sole freshness owner for loader-prefetched data. The
Router's preload freshness window is zero, so every loader invocation reaches
the exact Query key and lets that query's `staleTime`, in-flight deduplication,
and invalidation state decide whether a server read is needed. The Router must
not add a second freshness clock over Query-backed loaders.

Returning-conversation intent preload reads one contiguous updates page into the
existing history Query instead of skipping warm history or replacing its tail
with a recent bootstrap window. The mounted feed shares in-flight updates reads
by Space, acting Profile, and anchor; completed updates reads remain stale so
the subscription acknowledgement still closes the read/live gap. Successful
intent preloads are reusable for five seconds through Query freshness alone.

The Messenger sidebar also warms up to five cached unread conversations, newest
unread activity first, with at most two background jobs. It uses the existing
Organization unread summary and confirmed conversation Profile choices, excludes
the selected conversation, and does not hydrate cold saved Spaces in bulk.
An unchanged unread revision does not start another background read. Changes
during a read receive a trailing read. Hidden/offline pages stop queued work;
scope changes and unmount dispose the owner. Removed history queries cannot be
resurrected by late reads. Speculation never writes read cursors, scrolling,
Composer drafts, permissions, or Wake state. Failed prefetch keeps saved content
and leaves normal entry/reconnect recovery intact; it adds no polling or retries.

The Center Agent conversation is the deliberate exception to route-loader
intent preload. Opening or ensuring its DM is activation-only, and a read-only
preload must not return a different loader result that navigation could render.
The route disables loader preload and resolves canonical route data only on
entry. The primary app rail and global launcher may nevertheless prefetch the
read-only Center Agent DM projection on pointer intent or keyboard focus. When
that projection identifies an existing DM, Web restores the exact Space display
snapshot and history, then performs one bootstrap read and seeds the status,
members, history, and thread Query keys consumed by the activated conversation.
It must not issue parallel status or recent-history reads for data already
contained in that bootstrap. A missing projection ends prefetch immediately: hover and focus
must never call the open endpoint, create a DM, or perform another mutation.
The stable, read-only DM projection may persist in the approved Organization
browser-read segment. The full route and compact launcher render that cached
identity immediately and revalidate the projection in the background. Restored
Space content is display-only until current Space status confirms access;
mutations, membership editing, and other authority-bearing controls remain
unavailable. Members may show the same identity-only display cache as the mention
picker, including its count, while current access and membership refresh. These
cached rows have no member operations or live availability indicators; a failed
initial members read replaces them with the load error. A genuinely cold entry shows its pending shell only after the
shared optimistic-navigation delay.

Non-persisted bounded display data used by these frequently revisited routes
remains in the in-memory Query cache for 30 minutes after its last observer.
This includes the bounded Space bootstrap, status, recent history, and members.
Thread catalogs and opened replies use the same 30-minute in-memory revisit
window. Returning to a Space must not replace a newer Thread catalog with an
older cached bootstrap.
Inbox feeds, Profile directory display rows, account Space lists, and Center
Agent session lists remain in memory for 24 hours after their last observer,
so an overnight return can retain content during refresh. Their short freshness
windows and existing invalidation still apply. This does not add disk persistence
or extend readiness, membership authority, or Inbox snapshot validity.
After the entry access gate permits a cold conversation, route classification
uses status already returned by its bounded bootstrap or the mounted conversation.
It does not issue a separate full status request to distinguish Spaces from
Direct Messages. Space and direct-message routes reuse
that same bootstrap query in the conversation; saved-history visits keep their
existing contiguous-update path instead of requesting a new tail window.
While cold entry permission is pending, the app uses the existing conversation
loading layout, including a known account/Organization-scoped title and a linked
Thread loading panel when applicable. That shell contains no messages, composer,
or mutation controls. Error, password, membership, and profile recovery keep their
own entry surfaces. Web and Desktop consume this same Web-owned implementation.
Web requests `includeAgentReadiness=false` for this bounded bootstrap. Core
returns member identity for message presentation without waiting for runtime
readiness enrichment. The mounted conversation loads the authoritative members
query independently; a bootstrap marked `includesAgentReadiness=false` must
never seed or replace that query. Existing full members remain usable until its
own refresh completes. Bootstrap still checks access and seeds current status;
live reconciliation and explicit actions continue to refetch status and members.
Empty reaction rows do not mount layout observers.
The explicitly persisted display queries use the longer lifetime defined
below. Query-specific `staleTime`, live invalidation, and server reads still own
freshness; the Organization scope query is not given either longer lifetime.
Cached display data is therefore a first-paint aid, never membership,
permission, or mutation authority.

The account invalidation stream accelerates cross-Space Inbox and Space Index
refreshes in Web and Desktop. Its frames carry no item or preview data. The
client re-reads the owning projection on each frame and reconnect; bounded
polling covers missed frames and older Desktop builds.
Short-lived stream connections retain reconnect backoff until a keepalive
round trip succeeds. Disconnect resumes polling; reconnect refreshes the owning
projections. A disconnect alone does not trigger another full directory read.
While the stream is connected, the Inbox observation cursor and Desktop's
native refresh tick repair missed frames on a 30-second recovery cadence.
While it is disconnected in a visible window, the observation cursor backs off
from one second to a 30-second cap with jitter, and restarts at one second on
reconnect, focus, visibility, or a page with new observations. Remaining pages
still drain at one second. Direct Message previews that the Space index has not
projected yet are read once, not polled per chat: the next message projects the
preview, and the owning account Space and Center Agent session lists refresh it.

Authenticated route loaders may warm these same Query keys during SSR and let
the existing TanStack Router SSR Query integration hydrate them on direct entry.
Private, membership-scoped, real-time conversations must not be statically
prerendered or placed in a shared server cache; intent prefetch, request-scoped
SSR data, the account-scoped browser cache, and live invalidation are the
allowed acceleration layers.

TanStack Router restores ordinary pages by route pathname rather than the
individual browser-history entry. Space, Chat, public Space, and Desk routes
opt out through its public `scrollRestoration` option, including server-rendered
restoration. Their conversation/canvas owners restore their own positions;
the module sidebar retains its independent scoped scroll memory. The router
must not replay old pixel coordinates over a restored message or explicit jump.
The conversation records a persisted signal, its viewport offset, and whether
the reader is at the live bottom during scrolling and on departure.
Reading-position restore and the
history rail's Back action share this anchor selection. Optimistic sends, live
reply projections, and transient activity rows retain their display identities
but cannot become history anchors. Prefer the first visible recorded signal;
when transient content fills the viewport, retain a nearby recorded signal and
its offset instead. Existing stored positions are not migrated or invalidated.
The history rail appears only at widths of at least 640px with a primary
fine pointer that supports hover. Touch layouts do not reserve space for it;
history loading and reading-position restoration remain available. The
conversation notification bell also leaves the phone header; its saved
per-conversation choice remains in Space settings.
That account-and-Space-
scoped semantic anchor is restored in the layout effect as soon as history
mounts, before painting the default start position, loading earlier pages if
needed. Subsequent resize corrections run directly in ResizeObserver's
before-paint delivery; an extra animation-frame delay would expose the wrong
position as deferred message layout resolves. The callback adjusts scrolling,
not observed element sizes. A remembered historical position disables the
MessageScroller's initial end jump and automatic following. A saved live-bottom
position opens the live tail and follows it using the MessageScroller, even when
new messages have arrived since the previous visit. Older saved records without
the bottom flag keep their existing message-anchor meaning.
Resize observation preserves the same message
as images and deferred layout settle, until deliberate user scrolling takes
ownership. Reaching the bottom resumes normal following. Different Spaces
remain independent; explicit message-focus navigation takes priority over the
remembered position.
The conversation no longer reads a separate coarse-coordinate fallback.
Its semantic position keeps each tab's
session position and also saves a seven-day local-storage copy for a new tab or
browser restart. An existing tab's position wins over another tab's last saved
position. Auth cleanup removes both copies. This view-local presentation state does not
belong in the IndexedDB Query cache and is never message, read-cursor, or access
authority.

### Browser read-cache persistence

Confirmed reaction updates also replace the reaction snapshot on the matching
cached main-timeline message, within its existing Space and acting-Profile scope.
This includes mutation responses and refreshes after live reaction invalidation.
The bounded history persists and restores message text and reactions together;
the standalone reaction query is not a separate persistence family. Reaction
versions prevent older responses from undoing newer additions or removals. A
late response cannot recreate an evicted history or add a Thread reply to the
main timeline. A missing reaction snapshot is unknown and may fetch; a confirmed
empty snapshot is not mistaken for missing data.

OpenMeld Web may retain a narrowly approved subset of bounded display queries
in IndexedDB so a confirmed returning account can see useful route content
while current server reads are still running. TanStack Query remains the only
client read-cache API. Dexie is the IndexedDB storage engine underneath the
official TanStack Query persistence protocol; routes and components must not
read Dexie directly or create a second browser data model.

The persistence allowlist contains these successful query families:

- `startQueryKeys.profilesForStorageScope(accountId)` for the confirmed account;
- `startQueryKeys.currentComputerToolbarDisplaySnapshot(accountId)` for a
  versioned current-Computer toolbar hint containing only an opaque device id
  and a validated warning or danger reason/tone. It excludes the Computer name,
  inventory, readiness payload, diagnostics, paths, accounts, and actions;
- `organizationQueryKeys.spaces(organizationId)` for one confirmed account and
  Organization pair;
- `accountSidebarQueryKey(accountId, organizationId)` for the same confirmed
  account and Organization pair;
- `organizationAppConnectionQueryKeys.statusSummary(organizationId)` for a
  privacy-safe App catalog hint containing only the Organization id and the
  service ids that had an active Core-returned connection;
- `centerAgentQueryKeys.directMessageSpaceProjection(organizationId)` for the
  safe canonical Center Agent DM identity returned by the read-only projection;
- `spaceQueryKeys.history(spaceId, openMeldProfileId)` for one confirmed
  account, Organization, Space, and acting Human Profile. This is the same
  main-timeline snapshot consumed by the conversation and retains loaded pages
  within a 2 MiB signal-payload budget; the initial server page remains 30
  recorded signals; and
- `spaceQueryKeys.displaySnapshot(spaceId, openMeldProfileId)` for a versioned,
  validated Space identity and presentation snapshot with current actions and
  latest-message preview removed;
- `spaceQueryKeys.memberDirectoryDisplay(spaceId, openMeldProfileId)` for
  bounded member names and avatars used to render saved messages; and
- `spaceQueryKeys.historyNavigation(spaceId, openMeldProfileId)` for the
  validated, bounded history slider directory. It is display-only, scoped to
  the same confirmed Space and Human Profile, and revalidated by its query.

No prefix, default-on, or exclusion-based persistence rule is allowed. Adding a
query requires an explicit allowlist change, privacy and authority review, and a
test that proves unrelated queries remain absent. Organization scope,
activation, directories, Center Agent designation and open-command state, Space
bootstrap and current status, full Thread lists and Thread signals, membership
authority, raw readiness and current-device projections, Wake state,
diagnostics, errors, and every mutation remain excluded. The toolbar snapshot's
opaque device id is only a stale-hint rejection key after live inventory
arrives; it never renders Computer identity or establishes which device is
current. The
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

The saved Space history also carries display-only Thread summaries for retained
root messages, so the root and its reply entrance restore together. This context
has a separate 256 KiB ceiling, at most two preview messages per Thread, and no
reply placements. Preview bodies exceeding 16 KiB together are omitted while the
reply count remains. It shares the history snapshot's account, Organization,
Profile, access-revocation, and eviction boundaries. It never seeds the live
Thread query or establishes membership, access, or unread authority. Full reply
history remains memory-only. A cold Thread panel keeps its container quiet while
loading; cached replies remain visible during revalidation, and errors remain
explicit.

Current Space status is intentionally not persisted. After a successful status
read in the current signed-in account, Organization, Space, and acting-Profile
scope, Web derives the smaller display snapshot by removing current actions and
the latest-message preview before persistence. On a return visit, that display
snapshot and the bounded history may render immediately while current access is
checked. The composer keeps its normal authoring and Send experience without
presenting access-check progress or a separate retry control. A Send intent
first awaits the current entry resolution and a fresh current-status read, then
publishes only when both authorize posting. File actions and every other
mutation or authority-bearing secondary surface stay unavailable until those
current reads succeed. Pressing Enter follows the same boundary as clicking
Send. A transient pre-publication failure leaves the draft intact and reports
that the message was not sent, so the existing Send action is the retry.
Background `isFetching` and a transient refresh failure do not erase an already
visible conversation. An explicit access rejection immediately hides the
private content and clears only that
account-plus-Organization-plus-Space-plus-acting-Profile segment. Session
expiry, account replacement, or Organization-scope change still wins
immediately and clears its broader owning segment.

On a cold open with no safe display snapshot yet, the loading shell mounts the
same browser-local text draft immediately instead of a Composer skeleton. That
draft and its focus carry into the confirmed conversation without remount loss;
it still cannot send or attach files before current status authorizes the
mutation. After the entry gate permits entry, route classification must not
delay this shell. The header renders immediately and the message region stays
empty with an accessible loading announcement. Thread headers and Composers
likewise render independently of reply reads, without an entrance fade hiding
the controls.

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

When one current bootstrap contains both the bounded history and the current
member presentation, Web may fill a missing Agent `agentControllerRef` on only
those Agent signal profiles already present in that same bounded history before
the existing history query is persisted. This is a display-only repair for
legacy messages so a returning view can paint the bound Agent Controller icon
without first presenting the generic unbound icon. It does not persist the
members query, add profiles that are absent from the history, or establish
membership, readiness, Binding, or mutation authority.

When a saved Space list is visible and background refresh fails, Web keeps that
list visible, labels it as the last saved browser view, and offers Retry. Actions
that would change server state, such as joining a Space, remain disabled until a
current successful read completes. A paused offline refresh does not count as a
current read. Open navigation may remain available because the destination's
server read still decides access. With no usable saved data, the ordinary
skeleton and error behavior remains unchanged.

Saved conversation records share a 32 MiB browser budget. Expired records leave
first, then the least recently written Space records. Eviction never removes
messages from an already mounted reader. IndexedDB transactions merge loaded
history from concurrent tabs, retaining newer duplicate signals. BroadcastChannel
only requests rereading these saved views or server-owned facts; it never carries
private content or authorizes access. Scoped storage generations prevent an old
tab's delayed save from resurrecting content after account or Space cleanup.

IndexedDB unavailable, corrupt, over quota, expired, or blocked is an
observable acceleration failure, not an app failure. The network path continues,
corrupt records are discarded and may be repaired by a later successful read,
and schema version changes close older tab connections. The query-cache writer
subscribes only to successful data updates for the exact query owned by each
segment; unrelated query events and all mutation-cache events must not serialize
or write these records. After saved Space history is restored, the existing
live-tail reconciliation reads updates after its server-confirmed cursor. The
history query owns that cursor separately from retained and live display rows;
receiving a live row does not prove that intervening history was read. A missing
or reaped anchor falls back to the bounded recent-history read, which saves its
confirmed cursor for later visits and reloads. Older saved records without this
cursor use a recent-history read before catch-up. After Core accepts a live
subscription, on returning to a visible tab, or explicit recovery,
the same reconciliation owner also refreshes the current Space and viewer's
Thread catalog and retained Thread queries. Main-history cursors do not cover
Thread-only replies. Mounted Threads use their existing authorized reads;
unopened Thread snapshots remain stale until opened. Live Thread frames still
update the existing query cache directly. A live reply cancels an older pending
Thread or catalog read without reverting that update, then invalidates the
snapshot for its next authorized read. A later server snapshot can still remove
withdrawn replies; clients do not permanently union retained and live rows.
The periodic main-history reconcile
does not poll Thread history. Thread read failures retain their diagnostic
error and leave catch-up stale without restarting execution. On a
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
TanStack Query read cache and not a durable Space message. Web stores
their small serializable state in `localStorage` so a refresh, route remount, or
compact-to-full presentation change does not discard what the member was
writing. Draft identity is always scoped by the confirmed account plus the exact
conversation placement:

- one main draft per account, acting Human Profile, and Space;
- one independent draft per account, acting Human Profile, Space, and thread;
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
files stage as temporary Composer Uploads and remain invisible to Files until
Send publishes them. Web requests discard when a selection is removed or its
Composer scope closes; Core expiration cleanup covers refresh, window-close,
and interrupted-request cases. The unsent selection and local preview are not
restored across refresh in the MVP.

The send path takes an immutable snapshot of the current submission, clears that
draft once, and immediately leaves the Composer available for the next draft.
For main and Thread composers, this local feedback happens before entry
confirmation, status refresh, current Wakeability reads, or file publication.
The pending source and intended Wake presentation use the same client message
identity throughout admission, publication, retry, and reconciliation. Local
attachment previews cannot open Files or request file content until publication
returns canonical references. Server admission remains authoritative; local
feedback grants no permission and proves no delivery or execution.
An explicit send releases any restored reading-position anchor before scrolling
to the latest message; history or layout updates must not pull the new message
out of view. Restoring a page with an already pending send does not itself
override the member's reading position.
The next draft cannot send until the current request has a safe outcome, and
neither a success callback nor a projection refresh may clear or overwrite it.
After acceptance, projection refreshes run in the background and do not hold
the send lock. A failed preflight is definitely unsent; only a publication
request that actually started can have an unknown delivery outcome.
When a definitive unsent failure returns and no next draft exists, Web restores
the failed submission to the Composer. When the member has already started the
next draft, Web preserves that draft and keeps the failed submission visibly
marked **Message not sent** instead. Outcome-unknown submissions remain pending
under their original idempotent identity. An explicit sign-out or confirmed
account replacement clears all private Composer drafts before the next account
can render. Desktop preserves them during an invalidation-only session recheck
and clears them only after the authoritative session read confirms no account
or a different account. Invalid or corrupt records are removed. Unavailable or
full `localStorage` remains observable but does not block normal authoring or
sending. Composer drafts never authorize
access, enable a mutation, become offline send replay, or replace current Space,
thread, membership, or execution reads.

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
Compact Members rows explain checking and working states through the focusable
status indicator's tooltip rather than repeating them below the name. Actionable
failure guidance and recovery controls remain visible.
When Web creates or adds an Agent Profile to a Space, the successful
`addMembers` response may be applied to the current members snapshot immediately
so the new member appears without waiting for a slow follow-up refresh. Any
missing Wakeability must remain unknown/checking until Core's compatibility
read model returns it. For a newly created Agent Profile that Web just bound to
a local controller and added to the Space, the immediate mutation cache patch may
show `Checking` until the follow-up readiness refresh completes. Web must not
show `Offline` merely because the mutation response is missing or racing
readiness evidence. Live invalidation frames may trigger members/status
refetches, but they are not state and must not replace the Space/Core read
models.

Bootstrap member cache seeding is lower-fidelity reconciliation, not
authority. When an incoming Agent item omits Wakeability, Web may merge
its basic fields but must not erase richer controller, runtime, readiness, or
activity display evidence already read from the owning projection. An explicit
incoming Wake-availability verdict replaces the cached verdict; cached
`Available` state must never hide it. The current merge has no freshness order
between competing explicit verdicts and can briefly retain removed members
until the canonical members query refetches. Treat both as known Web projection
gaps: cached rows must never authorize Wake or membership mutations, and a
future fix must add explicit snapshot freshness and member-set reconciliation
instead of another client-side readiness source.

The Add People or Agents surface may present the designated Center Agent in its
own
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

Person Agent lists have a **Creation history** header entry in Organization
contexts. The dedicated Team history page lists self-owned creation records.
The retained teammate implementation, when enabled in an isolated lane, lists
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

**Settings → Personal → Privacy & Safety → Agent creation permissions** gives
every member separate **Start new conversations** and **Continue or copy existing
conversations** policies with **Ask me each time**, **Allow without asking**, and
**Don’t allow** choices. The preference is personal within the named Organization,
not an Organization-wide rule. The copy explains history inheritance without
implying approval of every Agent action or access to all local conversations.
Existing defaults and saved policies remain unchanged. Web reads and writes the
Core preference; it does not infer approval from role, friendship, request
source, or prior decisions.

For Profile Details dialogs, Web should consume the shared Profile Details
snapshot or section model from the shared contract layer. Web may render the
dialog, copy buttons, scrolling, and disclosure states, but it must not decide
Profile identity, Space membership, Wakeability, Binding, or local
connection truth by stitching unrelated browser-side facts together.

Profile Details includes immutable **Created by** and **Created from** rows.
They describe the actor and initiation surface, not the owner or current
Binding. The Advanced view may expose the exact actor Profile ID for diagnosis.

Agent Profile creation and maintenance surfaces may render Agent Controller
Permission Mode after the user has chosen a controller. Web should use the
shared runtime metadata so each controller shows native labels and descriptions
instead of a Web-authored abstraction. Owner-facing cards and editors retain compact controller-native mode names.
Editors explain the selected mode once in plain language and place key
controller-native launch settings behind a closed technical disclosure. Existing Agent Profile list rows should still show a
compact provider-specific fact such as `Codex permissions mode: Approve for me`, and
owner-self details may show the richer Binding fact. Web writes the mode through
the Binding API; it must not treat the selected mode as Space permission, Wake
readiness, local service truth, or a bypass of separate Computer file-access
limits.

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
Profile in that Organization before it creates a Binding, and all
later working-folder, Default Project, Binding, readiness, and Space-membership
writes must keep the same Organization id. Web exposes no cross-Organization
authorization or future-authorization choice. An unbound Agent Profile still
belongs to its Organization and must not be presented as wakeable until the
user connects a local agent.

Web treats the successful Auth Profile create response as an irreversible
creation commit point. It then records Space membership, local Binding,
working-folder, and Default Project work as explicit follow-up outcomes for
that same Profile. A follow-up failure must close the
create transaction as partial success, refresh the committed Profile into the
relevant lists, and show recovery copy that says what did and did not finish;
it must not leave the form in a state where submitting again creates a duplicate
Profile. For Space-originated creation, Web attempts the human-authorized Space
membership write before optional local setup. This keeps the new participant
visible in the Space even when the selected computer or Agent Controller goes
offline between form selection and Binding creation. A Space membership failure
still surfaces the committed Profile and directs the user to add that existing
Profile from the Members panel.

For a durable failed creation request with a non-null
`createdAgentProfileId`, Web labels the outcome **Profile created, setup
incomplete**, exposes the committed Profile, and offers **Retry setup**. That
action continues the same request and same Profile; Web must not reopen the
create form, generate a new creation intent, or offer cancellation as if the
committed identity could still be rolled back.

When the user selected a custom working folder, Web retains that private path
only as an account-scoped per-tab local settings draft keyed to the request. The
draft is bound to the committed Profile when one exists. A separate
account-scoped browser marker may remember that custom-folder setup is still
due after the tab closes, but it never carries the path: before identity commit
it is presence-only, and after commit it may carry the Profile ID. After Core
setup completes, the same **Retry setup** action continues with the
current-device workspace writer. A failed local write keeps the draft and the
setup-incomplete presentation; if only the marker remains, Web directs the user
to choose the folder again in Agent settings. Any successful, explicit
working-folder choice in Agent settings clears that Profile's remaining draft
and marker. Neither case may change the durable request back to creation, call
Auth, or hide the unfinished choice behind a completed badge.

## Space Image Presentation

A selected image keeps its presentation identity through staging, publication,
message failure/retry, and HTTP or live acknowledgement. Message actions still
use canonical signal IDs; the rendered message key includes Space, author, and
client message identity. Each published file is matched to its explicit local
selection, never to its name or position. Canonical cache admission occurs before
posting the message, so either acknowledgement transport finds the original.

The existing non-persisted `space-files` TanStack Query cache owns immutable
original bytes. Composer, thumbnail, and focused viewer subscribe to a shared
object-URL handle; releasing the composer does not revoke a displayed image.
Warm cache reads return the same handle during render, without a loading effect
or effect-created URL. A local File is transferred without conversion. Idle
originals have a five-minute GC lifetime and a 32-media/128-MiB retention budget;
mounted consumers are not evicted by that idle budget. The resource registry
contains handles, not a second copy of bytes. It is scoped to the QueryClient.

Logout, account/Organization cache clearing, Space access rejection, and an
authoritative file denial revoke active handles before discarding cached bytes.
Deletion of one file clears its revisions; folder deletion clears the Space's
image resources because not every descendant is in the current listing.
Revocation notifies already decoded composer and focused-view images as well as
message thumbnails. In-flight reads cannot repopulate a cleared account cache.
Binary bytes and object URLs are never admitted to persisted display histories.

One frame owns loading, decoded image, error, and retry. Attachment thumbnails
use a fixed 96-pixel square in messages and a 64-pixel square in composers and
inline editors, regardless of image count or source dimensions. `object-cover`
fills the thumbnail without distortion; cropping never changes original bytes.
The focused viewer still contains the complete original. Non-attachment detail
frames retain their bounded natural geometry and fallback. Decode completion is
source/attempt fenced. A decode failure offers explicit retry in the same frame.

`SpaceAttachmentStrip` composes the existing horizontal Fluid ScrollArea, its
overflow-edge fades, and its scrollbar. Media thumbnails and same-height file
cards occupy one non-wrapping row with an eight-pixel gap. Both legacy attachments
and canonical files remain accessible; canonical files retain their authored
order instead of being regrouped by MIME type. File cards show type-aware icons,
names, sizes when known, and the referenced revision. HTML keeps its shared badge;
unsupported formats remain files rather than invented image previews. Corners
follow the root Appearance radius through semantic utilities.

Main conversations and Threads compose the strip above and outside the painted
text surface, but inside the same message identity, toolbar anchor, and action
scope. Attachment-only messages have no visible empty text surface. Short text
does not constrain the attachment viewport. Center Agent's pre-Space pending
message uses the same local previews. Composer and inline editing share the
strip and item actions; existing and newly selected attachments are not separate
rows. Removal stays on the attachment, and file failures announce immediately
with click/keyboard-accessible diagnostics and retry in a popover, not a tall
error paragraph below the thumbnail. Upload limits, publication, retained file
IDs, and Agent context are unchanged.

Genuinely cold, active image loads use the pinned `img-fx` `ImageGeneration`
component through a lazy adapter. `images=[]` and `autoReveal=false` keep private
sources and decoding in the application; there is no artificial completion or
reveal delay. The stable frame remains observed after loading and failure.
Offscreen/background, reduced-motion, unavailable-WebGL, initialization-failure,
and context-loss states retain the static frame without an active renderer.
The small pinned package patch surfaces shared-context loss and avoids creating
WebGL before checking the required 2D output context. Normal package cleanup
owns GPU disposal; the application does not implement a second shader renderer.

The effect is an explicitly emitted, content-addressed module loaded by native
`import()` through a small failure-isolated adapter. A failed effect download
returns the static frame without emitting Vite's critical-route preload error,
refreshing the application, or delaying the original image. The build owns its
hashed URL and relative addressing; no URL-pattern exception or temporary global
error suppression changes recovery for actual application chunks. Build tests
execute emitted code with the effect chunk missing and verify that a separate
critical import still emits its normal recovery event.

Unit and controller integration tests cover resource ownership, geometry,
acknowledgement ordering, decode retry, and privacy. Browser/native visual smoke
is a separate acceptance gate, including the previously reported PNG grey
preview; header metadata and jsdom tests alone do not establish that incident's
root cause or verify GPU rendering.

## Space Video Presentation

Conversation, Thread replies, Files details, and the local composer share
`SpaceVideoPreview`. Video remains a canonical Space File revision. Idle cards
use the browser's native lazy video loading to show the first frame near the
viewport. Compact message and composer cards retain their square poster and
open the existing shared player only in the dialog; preparing its module does
not mount an inline player in the thumbnail. Native posters also subscribe to
account, Space, and file revocation before the player module is loaded. Larger
Files detail cards still prepare the inline player when a visible frame is ready.
The player module loads once and no per-row observer is created. This introduces
no poster-generation or transcoding service. The shared Media Chrome controls
overlay the picture without an opaque control bar.

Player preparation or explicit Play/Expand loads the player through `optional-media-modules`, the
same content-addressed native-import boundary as image decoration. A missing
player chunk exposes retry without triggering critical-route reload recovery.
Critical application imports keep their existing behavior. The player is absent
from server bundles and the initial Space dependency path.

Remote playback uses the existing same-origin file-content route pinned to the
message revision. The proxy owns cookies and the non-secret Organization
selector; passwords and long-lived tokens never enter the URL. Core authorizes
the revision before requesting a bounded R2 range. Private/no-store semantics
remain unchanged. Remote movie bodies never enter TanStack or Dexie; the browser
owns the active buffer. Historical Files previews wait for the requested revision
descriptor and do not download whole movies through the text/image query.

The existing resource owner is now named `space-file-media-resource`. It retains
original local video Files and object URLs through staging and publication,
without conversion, duplication, or a second cache. Image ownership, budgets and
persistence exclusions remain unchanged. Active remote players also subscribe to
this owner's account, Space, and file revocation events, without a cached body.

Inline-to-dialog transfer records time, rate, volume, mute and playback intent,
releases the old decoder, then restores the new one. Close releases playback;
hidden documents and hidden React Activities pause without automatic resume.
Only one video plays per document. Autoplay refusal leaves usable paused controls;
unsupported formats retain retry and original download. Browser/Desktop visual,
seeking, focus, and Space-switch timing smoke is separate from component tests.

## Space And Thread Presentation

Web presents a Space as a collaboration room and visible outcome surface.

Explicit message destinations prioritize the existing canonical status read
after entry confirmation, alongside the full bootstrap. Authorized Thread
catalog and content reads can proceed without waiting for main-history and
member enrichment; the existing conversation surface renders as soon as its
status and target content are available. Sending, Wake, membership, drafts,
and viewed-through watermarks retain their existing owners and admission rules.
Route prefetch resolves a missing viewer through the existing remembered/default
Human Profile policy instead of waiting for the profile-correcting navigation.
It does not invent a viewer when that policy has no valid selection.

Browser notification activation uses the application router for internal
destinations and retains external provider links as external navigation. The
click callback checks the current account and uses the delivery-time validated
source target. It does not use notification preview text as message content or
mark an item read merely by prefetching its destination.

Entering a conversation renders the latest 60 cached timeline signals by default,
without discarding older cached history. An older saved reading anchor opens a
bounded cached neighborhood; missing anchors use the existing server history
navigation. Explicit older-history loads expand the visible window, while new
live messages do not move its start. Space, DM, and Desk readers share this rule.
If an explicit message anchor is missing, a successful authorized latest-window
read is a latest-navigation result, not a loading error. The conversation scroll
owner positions that window after rendering and shows one explanatory notice.
Permission and network failures retain their failure semantics; no cross-Space
anchor search is allowed.
Direct-message previews reuse the Account Space Index projection when provided,
including its explicit empty value. Only conversations without that projection
retain the per-conversation preview read.

The Space and DM title never shows a green live-connection dot: a healthy
message stream says nothing about Human presence or Agent Wakeability. Initial
connection, routine history loading, and short recovery attempts stay silent,
including for screen readers. The title has no loading or connection badge.
After live updates or catch-up remain interrupted for 15 seconds, the Messages
area shows one muted notice: **Messages and activity may be out of date.**
**Retry** retries catch-up when stale or reconnects an interrupted transport.
Keep the notice stable across retries until recovery is confirmed. Existing
history errors take precedence; Files and Tasks do not repeat this notice.
These states do not derive Computer connectivity or override Core-owned Agent
readiness or execution outcomes.

**Space settings** uses the shared Fluid Dialog and Settings navigation, with
General, Members, Share & Access, and Advanced sections. General contains the
canonical name and the existing global browser-notification control. Members
directly shows the member and ownership controls without an accordion; its
**Invite people** action opens the shared invitation view. Share & Access owns
Organization visibility, link reading, joining, and guest participation. Its fixed
footer places **Share this Space** opposite the draft controls and **Save
changes** action. **Share or invite** is link-first: it asks **Who can read this
Space?**, then asks **Who can join this Space?** when joining applies. Each
selected value reflects the effective Organization and external audience, not
only the raw link rule. The main view does not show
a permanent URL field, Organization visibility, guest access, members, or the
invitation form. For invitation-only joining, **Invite people to join** sits
beside the relevant selector and opens that form as a child view in the same
dialog; it is not a permanent footer action. Guest invitations use one
Guest/Teammate selector. Submitting the first Guest
invitation while guest access is off prompts Owners for confirmation, then
enables guest access and continues the same invitation; it does not require a
trip to Settings or a separate enable step. Copy link never grants access. A
changed policy stays a visible local draft until the owner uses **Save and copy
link** in Share or invite or **Save changes** in Share & Access. Share or invite
saves first and copies only after persistence succeeds; clipboard failure
reveals the URL for manual recovery without reversing the successful save or
claiming copy success. Both surfaces reuse the same access facts and invitation
components rather than defining separate permission rules. Pending invitations
use progressive disclosure.

The Share or invite dialog and Share & Access settings replace each other as
controlled surfaces while preserving one unsaved draft. Closing either surface
requires one explicit discard decision;
switching between them does not prompt. Entering invitations with a dirty access
draft offers save and continue, discard and continue, or go back. Selecting the
teammate invitation surface loads persisted invitation-link
state; merely opening Share or invite does not create or renew one. A single conditional
insert checks link history: reopening reuses an active link and never recreates
an expired or revoked one. Renew explicitly replaces a link; Revoke, Renew, and
Copy stay right-aligned. Share & Access keeps guest participation in the same draft and fixed
save footer as the other policy fields. Turning it off warns that existing
guests are blocked rather than removed, so restoring it restores their access.
Public reading remains available to anonymous readers and does not require guest
access. Share or invite does not duplicate the guest-access switch.
Invitation links are read from Auth when the panel opens, scoped to the account,
Organization, optional Space, and direct/request mode. A mutation response is
not the only way to display an existing link. Failed reads offer retry rather
than presenting the absence of a link.
New Web Spaces use members-only access; General access selects only invited
people or everyone at the Organization. Existing external link modes remain
visible and editable without changing either policy implicitly. Advanced contains Space ID, CLI join command, joined profile, and existing
confirmed leave/delete actions. **Chat settings** shares the same composition but
omits Access, CLI join, and lifecycle mutations while the conversation is a DM.
The creator profile,
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
requests member snapshots and applies the successful response to the current
members, status, bootstrap, and Account Space Index caches before
replace-navigating immediately to the ordinary Spaces
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

Every direct Space entry uses the shared Core Space entry resolution before it
enables a member or public conversation. After current account and Organization
confirmation, a returning app route may mount its scoped saved display and
history read-only while entry resolution runs. Public routes and routes without
that saved pair keep the ordinary entry gate. Explicit rejection removes the
saved view; transient failures retain it with retry. The Web entry gate consumes that
resolution as the only routing decision: it opens the member experience, opens
the public read-only experience, asks for sign-in or a protected-Space password,
offers Join for an Organization-public Space before loading its private content,
shows the private Space membership block with the safe Space name and owner,
or shows a non-disclosing unavailable state. Web does not reconstruct access
from status, the Account Space Index, or a failed conversation request. A
transient resolver failure keeps the target and offers retry; it is not treated
as denied access.

The public reader reuses the member history navigator for anchored windows and
both directions of retained history, and reuses read-only Files, Tasks, and pin
surfaces. It preserves the resolved message/Thread target across sign-in and
explicit join. Joining reloads the shared entry so Core chooses the guest or
Organization experience. Public entry revalidates on focus and every 15 seconds
while visible; rejection removes the mounted reader. Its HTML advertises the
shared JSON context directory and is not cacheable or indexable.

For an allowed public entry, the ordinary `/spaces/:spaceId` response also
server-renders a bounded conversation window into its initial HTML. A targeted
message or Thread link renders the Core-resolved anchor window and selected
Thread; the latest view renders a bounded recent window. Existing history and
Thread controls expose same-Space links so a reader without JavaScript can move
through older windows, return to latest, and open Threads. Hydration reuses the
same request-scoped query data and preserves the interactive reader. Web must
resolve access before reading or serializing conversation content, must not
derive policy locally, and must keep both public HTML and its content-bearing
GET server-function responses private and non-cacheable, including denied
access, invalid input, and upstream failures.

Organization-scoped routes retain the App shell for permitted public reads and
membership gates. Tenant-neutral links resolve to the Organization App route
before mounting a public viewer when Core supplies the caller's Organization
slug. A stale or foreign Profile selector is replaced with the current account's
Human Profile inside the App; it is never used to authorize another account.

The entry target may include one Signal and one Thread root Signal. Web carries
both selectors through sign-in, member/public route reconciliation, and
password recovery, then focuses the message or opens the Thread only after
access succeeds. A blocked page never reads conversation content to discover
those targets. A future join-request action extends the resolver's recovery
tail and returns to this preserved target; it does not create another access
gate.

Web builds both whole-Space share links and message links through the shared
public Space-entry link builder. A message link is a secondary action in
**Message details**, where the user can see and select the full destination;
it is not another control in the already-dense inline Message Actions row.
Thread-message links preserve both the selected message Signal and the Thread
root. Copying a link does not claim or change access.

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

The first bootstrap-backed conversation frame resolves Agent presentation from
the members included in that same bootstrap instead of waiting for a second
cache-notification render. If saved legacy history becomes visible before the
current bootstrap, a static reserved icon placeholder represents the unresolved
controller; Web must not present the generic unbound icon until current members
confirm that the Agent is actually unbound or unknown. After bootstrap, a newer
members presentation replaces any older per-message controller snapshot so
rebinding updates the icon and unbinding clears the previous controller mark.
Re-entering a Space must not let an older cached bootstrap patch a newer members
generation; bootstrap history enrichment uses the newer of those two identity
presentations.

It should keep the familiar conversation model clear:

The authenticated ordinary shared-Space header exposes **Messages | Tasks |
Files** as one
keyboard-accessible tab list. Files keeps the same Space header and membership
context; it is not a Resources redirect or a second app shell. Opening Files
loads the Space root, and opening folders uses breadcrumb navigation without
changing file identity.

Tasks opens one responsive board with **To do**, **In progress**, and **In
review** as the active columns. Done and Canceled stay in collapsed history
groups instead of creating a competing list view. Board cards stay compact:
title, phase, assignee, requester, linked issue identifiers when present,
and one next-action or attention line.
The board can filter its already-authorized Space Tasks by an explicitly
associated Project. This filter does not select a write destination, grant
Project access, or turn a bounded Task page into a complete cross-Space
Project index; the existing truncation notice stays visible.
Opening a card reveals a right-side detail drawer with the brief, completion
conditions, associated Projects, linked GitHub or Linear issues, current result,
people, and only the controls
the current profile can plausibly use. Completing or canceling a Task that
still has an open GitHub issue prompts the person to close that issue in
GitHub. Core remains authoritative and rejects stale or unauthorized
mutations. Private conversations reuse this board, message cards, and creation
flow. Center Agent navigation places Tasks after Messages. Before a chat exists,
Tasks uses the same board empty state and creation dialog, without a transcript
or composer. Submitting creates the chat and Task directly, then stays on Tasks;
it does not send a message or start an Agent. Opening Tasks alone creates no chat.
The Messages composer separately supports a Task in its first-message handoff.

Agent mention menus keep execution settings separate from Tasks. **Working copy**
chooses **Current folder** or **Separate copy**, and offers **Choose Project…**.
A separate copy requires a readable configured Project; selecting it retains
the selected access policy. Project selection defaults to a separate copy without
adding a task restriction. **Access** independently offers **Use agent settings**,
**No project files**, and supported **Read files only** / **Project files only**
restrictions. Returning to Agent settings preserves an existing project copy;
leaving Space-only scratch work returns to the current folder by default.
**Session → Automatic** remains selectable and clears explicit Access, Working
copy, and Project preferences. The existing session retains its own restrictions;
copy and access choices remain in place until the user selects Automatic.
Claude's explicit project restriction requires a separate copy and its tooltip
explains the container and network limits. Continuation and fork choices inherit
their source settings and disable both controls. Shared Tooltips explain copy
and permission effects without presenting a working folder as an access grant.

The Project selector in Task detail supports zero or several associations and
uses the current Task revision. Unavailable saved associations remain removable,
including when no active Projects remain; saving never silently drops them.
Common Agents from those Projects are
prioritized among existing Space members. For an Agent outside the Space, the
same assignment flow shows that Agent and its owner as incoming members before
offering **Add and assign**. It reports a successful membership write followed
by a failed Task assignment as a partial outcome. The outcome stays visible
independently of remaining candidates and membership refresh, for that Task.
Linear issue links show their
exact identifier and that status is not monitored.

Every retained text message in an eligible Space has a secondary **Add to
Tasks** action. The created Task preserves that Signal as its source, inherits
the source Thread, and assigns the sole Woken Agent when the message addressed
exactly one. The action opens Tasks only after the server receipt succeeds.
`space.tasks.changed` invalidates the Space Task query; the frame never mutates
the board directly.

Task details load the exact Task independently of the board list and request
`includeAffordances=1` for the server's actor-scoped `allowedActions` and
delivery status projections. Older clients keep the legacy detail response;
missing capabilities fail
closed. This includes Space owner recovery and explained review overrides,
assignee management, and human authorization of another rework round. Reviews
name the result revision shown to the person. Revision conflicts refresh the
details and ask the person to reconsider; Web never automatically resubmits a
semantic decision against newer work.

The drawer exposes the canonical source message even when it has no Thread,
editable briefs and completion conditions for eligible actors, the current
result and review feedback with their result versions, and a collapsed activity
history. Capturing a message keeps the source as the complete context rather
than copying a second authoritative message body into the Task.

The board's phase filter includes Done and Canceled history. Each list remains
bounded to 500 Tasks; truncated views disclose that older Tasks are omitted,
and counts describe only the loaded view. Full cursor pagination is not yet
available.

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

The active Files list defaults to artifacts only (see the Space Files origin
contract above); it never applies this filter to Trash. A **Show chat
uploads** toggle beside Trash switches the request to `origin=all` and updates
the subtitle to say chat uploads are included; toggling back, or switching to
another view (Trash and back), returns to the default — the toggle is local
Files-view state and never survives a `changeView` call. When chat uploads
are shown, each file whose `origin` is exactly `"chat_upload"` carries a
**Chat upload** badge next to its name so the distinction stays visible in
the row, not only in the toggle state. A file with no recorded origin never
gets this badge; the fail-closed default list does not extend to asserting a
source it does not actually know.

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

Returning to the file list, changing **Messages | Tasks | Files**, opening a
different chat file, following an internal route, reloading, or closing the
window with a local draft uses the same save, discard, or cancel contract as
Organization Documents. A repeated click on a chat file card reopens its exact
sent revision even after the viewer temporarily returned to the current file.

- the main timeline shows root conversation messages
- `Reply to` creates a normal reply relation to a message
- `Reply in thread` opens the thread panel
- thread replies stay in the thread panel
- the Thread header's **Go to message** action focuses its root message in Messages
- the root message may show a compact thread preview
- the main timeline must not render thread replies as standalone root messages

Each reply preview occupies one truncated line and opens its exact reply with
scroll and highlight, including repeated selection. Hover underlines only that
row. The Open thread action uses the same spacing as the preview rows.
Starting a new Thread opens the existing loading panel before creation completes.
Closing or switching the panel while creation is pending must not be undone by
the response; the server result updates the query cache, not panel selection.

On desktop, the inline Members and Thread panels are resizable from their left
edge because they occupy the right side of the Space. They reuse the shared
sidebar resize mechanics, including pointer drag, keyboard resizing, bounded
minimum and maximum widths, and reduced-motion behavior. Thread can grow to
60rem, constrained by the available conversation area after other inline panels,
with 512px reserved for the main conversation. When the available area cannot
fit that width alongside Thread's minimum reading width, Thread covers the
main conversation area until closed instead of crushing either column. Its
overlay width excludes other inline panels, so opening Members keeps Members
visible and interactive beside Thread. Only the covered main conversation is
hidden from interaction and the accessibility tree. A smaller viewport
constrains the displayed width without overwriting the saved wider preference.
Members and Thread widths are persisted as separate browser presentation preferences. The
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

Members header descriptions own a full-width row below the title and actions.
The header Add People or Agents action and the one-member empty-state card both
open the same Add People or Agents dialog. Empty-Space setup and Welcome Space
actions open that dialog directly without expanding Members. Closing the dialog
preserves whether the user had already opened Members. New Agent is a compact
primary action at the right of the current user's People row, including when
they have no Agents. The title row is reserved for the title and close action.
Invite remains below the description for organization members and stays stable
while role information loads; an unresolved role cannot enable a direct invitation.
New Agent replaces the content inside this same dialog, with Back returning to
the picker and preserving selection. Connect Computer inside creation opens the
shared ComputerSetupFlow in the same dialog and keeps the creation controller
mounted. Back and verified completion return to that creation step without route
navigation. The standalone Connect route retains its existing return target.
Creation does not grant Space membership:
the new Agent returns selected in the picker, and the user can create another
before the final Add selected operation. Pending teammate requests are not presented
as created Agents. Only the final membership operation closes the picker.
The picker presents People as the primary hierarchy, expanded by default, with
each person's addable Agent Profiles indented below their People row. A person
who is already in the Space remains visible even without Agents, labeled
In this Space. Center Agent remains Organization-owned, appears first in a separate
Organization group, and carries a compact Remote badge with a cloud icon and
shared surface background and shadow tokens. The hierarchy uses
spacing, avatars, and typography rather than nested cards or borders. Selecting
an ordinary Agent explains and counts
the Core-owned owner-Human participation effect without submitting a duplicate
owner selection. After Core confirms an Agent or Human membership write, Web
closes the dialog. Names use the same compact type scale as the app sidebars so
the Members panel does not introduce a heavier navigation hierarchy.

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

Mention suggestions open immediately after a typed `@` at a line start, after
whitespace, CJK text, or supported sentence punctuation. Email addresses remain
plain text. Escape and the visible **Close mentions** button use the same
cancellation path: preserve the literal `@` and entered query, remove the
transient picker input, and return focus to the composer.

A pending reply appears as a compact single line inside the composer, with a
leading **Cancel reply** button, a divider, and `Replying Name: preview`.
The preview resolves profile mentions to names, is capped at 100 characters,
and truncates to the available width. Canceling a reply preserves the draft.
Sent-message quotes retain their original-message navigation and use muted
text to distinguish quoted content from the new reply. Quote previews stay on
one line and truncate with an ellipsis when they exceed the available width.

A blocked Wake token uses a muted name and grayscale icon while keeping its
remove and relation controls usable. The composer pairs compact availability
copy with the current Agent recovery action, including computer connection,
before submission. Reference targets do not block sending. Both main and thread
composers consume the same Core availability and recovery projections.

Every writable Space composer — ordinary Space, Direct Message, Center Agent
Direct Message, and thread — uses the same file control. The former paperclip
is a Plus button labeled **Add to message**. It opens the shared Fluid dropdown
above the composer with a **Files** item so later composer actions can be added
without changing the primary control. The file picker accepts arbitrary files;
paste and drag and drop use the same path.

A composer accepts up to ten files, each up to the shared 1 GiB Space File limit.
Selection immediately stages each file as a temporary Composer Upload and keeps
a removable local row with image thumbnail when available, file name, progress,
failure, and request id. A staged upload is not listed in Files. The file tray
keeps compact fixed-width cards in one horizontal row and scrolls horizontally
when they exceed the available composer width. The visual scrollbar stays
hidden so it does not consume Composer height, while pointer, touch, and
keyboard scrolling remain available. Image thumbnails open the shared preview;
filenames appear in tooltips and removal remains visible. Normal upload progress
and Ready labels are hidden, while failures stay explicit. Send immediately
stages the outgoing message and frees the Composer. Its captured attachment batch
finishes staging and publishes canonical Space Files in the background before
the message is formally posted. File-only messages need no invented caption.
Failed attachments are never silently omitted, and publication failure preserves
the entire message for retry with the same upload identities, including files
that already published. Navigation preserves each conversation's attachment draft.

Each file-publication request has a 30-second deadline and reuses the existing
single automatic retry with the same mutation identity. If both attempts fail,
the message keeps its attachments and exposes Retry; its send queue reservation
is released so later messages can proceed. This bounds publication of an already
staged file, not the byte upload or an Agent execution. A lost publication response
does not justify creating a new file identity on retry.

After publication, Web submits only server-returned Space File references. A pending
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
durable Agent work details. Human-authored message bodies retain plain-text
formatting while recognizing bare URLs and labeled Markdown links. External
HTTP(S) and email links open separately with `noopener noreferrer`; code and raw
HTML never become automatic link previews.
The shared safe Markdown renderer strips raw HTML, does not render Markdown
images, and applies the existing link and internal Space-reference policy.

Durable, unrecalled Space messages share the same link-preview presenter across
senders and threads. It renders compact cards below the body, enriches visible
messages asynchronously, and initially shows at most three cards. Missing
metadata leaves a usable domain link. Editing uses the new message revision;
recalling removes the previews. Shared `LinkPreviewCard` owns presentation,
while Web owns message lookup, access context, query caching, and disclosure.

Web owns content typography separately from rendering semantics. The local
shadcn Typeset stylesheet supplies element rhythm for rendered HTML, while
`clients/web/src/styles/content-typography.css` owns semantic presets and the
unexposed content scale. Human Space messages remain plain text but consume the
same Space message size, line-height, and body-font tokens as Agent Markdown.
The shared Plate Markdown editor used by Organization Documents, Organization
Skills, and Space Markdown Files consumes the document preset. Every
`MessageResponse` call must select an explicit presentation preset so a new
surface cannot inherit chat styling accidentally. The public Changelog selects
its own fixed preset and does not consume the app content scale; changing Space
or document typography must not change Changelog presentation.

Inline Profile Mention tokens opt out of Typeset with `not-typeset` on their
shared root, for both interactive and display-only rendering. Their avatars
belong to the token, not the prose image flow; Markdown lists and headings must
not add media margins inside Human Mention, Agent Wake, or Reference tokens.

For an authenticated Organization view, a resolved reference navigates to the
app route `/o/{orgSlug}/spaces/{spaceId}?profileId={activeProfileId}`. The
canonical message token remains `/spaces/{spaceId}`; message authors and the
Center Agent must not hard-code viewer-specific app URLs. If an initial
Organization Space Directory projection is still loading or stale, Web renders
the app link immediately with a shortened Space ID, then replaces that label
with the resolved Space name. Web may perform one bounded refetch for newly
observed unresolved references, then respect the refresh cooldown. Anonymous
views keep the public route behavior.

An Agent Profile Organization mismatch is an identity failure, not actionable
configuration. Space outcome rows state that the Agent belongs to another
Workspace, present no Wake-access repair action, and keep destructive failure
severity. Web must never deep-link to a retired authorization surface.

Thread placement is conversation placement. It is not execution truth.

Latest, focused-message, and history-window views consume the same presented
Wake progress. Navigation may select a different history page; it must not
clear the progress or authorized Stop controls on a visible Thread entrance.
A public stream arriving before its Wake snapshot uses the same named Working
presentation without inventing lifecycle or Stop eligibility. Matching Wake
snapshots and durable outcomes take precedence over that stream. Thread history
loading does not hide already available live work. History and progress reads
remain independent; neither waits for the other to render.

Direct Messages and ordinary Spaces share the same unfinished Agent answer row.
Its compact progress distinguishes **Sending request…**, **Waiting to start…**,
**Connecting…**, and **Retrying delivery…** from confirmed **Working…**.
Pre-execution phases do not show the working Orb or elapsed-work indicator;
source-level summaries and the sidebar preserve the same distinction. Active
work, reply streaming, and publication retain **Working…**. Authoritative
waiting, input-required, confirmation-pending, and terminal outcomes retain
their distinct meaning. When shown, elapsed request time begins with submission. The row's
avatar and identity header name the Agent once, while source-level summaries
still name each target when multiple Agents are involved. The work disclosure
opens only when reasoning, public progress, or tool steps arrive; reasoning
capability alone must not produce an empty panel. An unfinished answer
is not a saved Signal and must not request message reactions. Stop eligibility
comes from the current owner evidence, including Hosted admission that completes
while a progress read awaits remote dispatch evidence.

For hosted Center Agent and Remote Agent Space replies, Web may overlay
explicit public progress updates and accumulated stream text while the turn is
active. Neither live projection is a Space message or final outcome. Public
updates appear inside the Agent bubble in the Work summary disclosure, sharing
its bounded scroll viewport with tool steps when present. Hosted model-emitted
reasoning uses the same disclosure across Direct Messages, shared Spaces, and
Threads, with the existing conversation audience checks. Local Agent reasoning,
when the owner permits it and the controller supplies it, uses this same
disclosure and Markdown renderer instead of a second collapsible panel. The
reasoning remains transient and retains its separate privacy policy; Web never
turns it into hosted public progress or durable reply history. Web does not write
an active stream to its browser read cache. On successful publication, the final
Signal may retain up to 8,192 characters of explicit public updates as
`agentPublicProgress`; failed and stopped streams retain none. The published
reply's collapsed Work summary lets the reader reopen those updates from
history. Reconnect restores the privacy-safe active stream presence and any
accumulated text; a bounded live progress tail can be replayed from the Space
instance, but is absent from bootstrap.

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

The live work disclosure shares the existing progress row instead of adding a
second row and keeps Stop immediately after the expandable work summary.
Work disclosures and link previews must fit the containing message, including
when a desktop Thread is resized without changing the browser viewport. The
working label may wrap and increase the header height; the supporting summary
truncates, and Stop remains within the bubble. Long work-step names wrap instead
of widening their scroll viewport. Code, tables, and attachment strips retain
their own horizontal scrolling without widening the message.
Unchanged work steps retain their rendered motion trees during streaming text
updates. The shared step uses React's default prop comparison so status, label,
icon, and content changes still render immediately.
While the authoritative stream is
active, that row keeps `Working…` as its stable primary state and shows
the concrete current work as supporting context. Work activity must never
replace or hide the active execution state. The live progress row belongs inside
the Agent answer bubble after any accumulated answer text and before the
message footer, so the state remains visually attached to the Agent and message
actions never precede it. The summary opens while the stream is live,
collapses after the final reply, and remains under the reader's control. Its
scroll viewport is no taller than 12 rem or 30% of the dynamic viewport.
Web first reconciles lifecycle parts by tool-call identity so starting and
completed evidence for one call remains one step. It then groups only
consecutive calls with the same semantic work, safe subject, and lifecycle
state; a success and failure are always separate, exact rows. Web retains at
most the latest 50 admitted live calls. New work follows the bottom while the
user remains there; scrolling up pauses following and shows one
`new step · Jump to latest` control instead of pulling the user away.
Reduced-motion preferences disable smooth following. Known active execution
occupies an unfinished Agent reply before text arrives, in both ordinary Spaces
and threads. Public work fills that same reply without waiting for answer text.

Space messages and Thread messages do not render a separate `woke Agent Name`
receipt. Instead, the inline Agent token shows its exact Wake or Reference
relation. Graph and the structured message envelope retain that relation for
agents and diagnostics. Message details remains the drill-in for complete
execution and failure context.

In an ordinary Space, the first message in a speaker run shows its 24-hour,
hour-and-minute time beside the speaker name; later messages omit the time in
the timeline. Direct messages keep the compact avatar-and-bubble layout without
a separate header time. Each direct message shows its 24-hour, hour-and-minute
time inside the floating toolbar. Message details remains available for an
individual message. Message actions form one floating
toolbar beside the bubble, or slightly over its upper edge when neither side
has room. Individual message items must allow this overflow; paint containment
belongs to the conversation viewport, where it cannot clip a toolbar between
consecutive messages. As a long message scrolls past the top of the message
viewport, the toolbar aligns with that message's lower visible edge while it fits beside the
bubble. When it must overlap the bubble, it straddles that lower edge if there
is room. It remains inside the viewport when the message continues beyond it.
It prefers the opposite side of a right-aligned self message and the right side
of a left-aligned message. Phone widths show reaction and More actions, keeping
the full set of actions available from More. The floating toolbar never reserves
bubble width or a footer row: when it cannot fit beside the bubble, it overlaps
the upper edge without changing the bubble's width or height. When a message has
a failure, the visible toolbar keeps only one red Message details icon and More
actions; Copy, Reply, and Thread move into More actions. Otherwise the expanded
toolbar shows reaction, Copy, Reply, Thread, and More. More holds Message details,
Addressing, and other less frequent actions without repeating visible toolbar
actions. A successful Copy briefly changes its icon to a check; a failed Copy
leaves the copy icon in place. Toolbar icon controls
use a compact 28-pixel container with 6-pixel visual padding. A failure colors
the Message details icon red but does not show a persistent hover or selected
background; that background appears only through real interaction state. The
failure summary is available in the icon's accessible name and tooltip instead
of repeating a red sentence in the conversation. Clicking or keyboard-activating
the icon opens the Message details drawer. Owner-visible original Local Agent
errors appear there immediately, labeled by Agent, with their original text and
line breaks. They are not duplicated under Technical details. The existing
bounded, owner-only error projection and sensitive-data exclusions still apply.

Message rhythm follows the existing speaker grouping instead of the current
member's alignment. A consecutive message from the same speaker starts 1 pixel
after the preceding bubble. When the speaker changes or the existing conversation grouping starts a
new run, the adjacent run edges contribute 6 pixels each for a 12-pixel group
boundary. Date separators, system regions, and other real section boundaries
keep their wider spacing. The floating toolbar does not change message height
when it appears.

In the full message body on the main timeline and in the Thread panel, the
first visible mention owned by each structured Agent Wake or Reference renders
as one compact read-only token: `@`, the Agent's 14-pixel Profile icon, its
semibold canonical name, and the exact relation. Later appearances of the same
structured Agent render as Reference tokens, matching the Composer's duplicate
rule without adding another Wake target. The token uses the same visual family
as the Composer control but has no selector or caret. Activating any point in
the token opens that Agent Profile's compact Profile Details popover; hover and
keyboard focus use the token surface and never underline the name. Web derives
this presentation only from structured targets and resolved Profile
presentation. It does not decorate ordinary mention-like text in messages with
no structured target, code, links, or quoted reply previews.

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
Codex, Claude Code, Grok Build, Cursor, OpenCode, and future controllers. A work
row must not infer permission guidance from a generic command-tool error, and
Web never changes permissions automatically. Because every message in a
one-to-one Center Agent Direct Message implicitly wakes the Center Agent, the
Direct Message may derive one optimistic reply shell from the active Wake
presentation immediately after the
user sends. The shell shows only the already-known Center Agent identity and one
compact animated status row. A missing or legacy automatic Center Agent avatar
uses the shared Clover Bot presentation until its saved style is available.
The new-chat transcript reuses MessageScroller's follow and user-scroll behavior;
starter cards remain in the transcript. A pending first send keeps this shell
while membership is unknown, rather than displaying a join prompt.
That row uses the same phase-specific progress as other Spaces and reserves one
stable Stop-control slot so transport evidence does not move the conversation.
Connecting or retrying delivery must not appear as confirmed Agent work, even
when the request has been pending for a long time. Authoritative transport
diagnostics still distinguish direct, Queue, fallback, and admission stages.
Web does not invent a reasoning state. Once work is confirmed, the existing
presentation-only elapsed timer starts at the source request's submission time
and includes delivery, preparation, and working time. It never
determines execution health or a timeout. The
optimistic source message itself is sufficient immediate send feedback and must
not add a short-lived
`Sending...` row; if delivery remains pending for eight seconds, Web may add
`Still sending...`. The source message must not render a second Wake progress
row while this shell is active. The shell is not a Space message, stream event,
tool activity, reasoning claim, or execution authority; Web must never persist
it. Ordinary Spaces derive Agent progress from their existing Wake projection.
The first authoritative stream
projection, durable reply, stopped notice, or failure notice replaces the shell,
and the shell must disappear when its active Wake presentation ends. An empty
active stream keeps `Working…` instead of renaming that state to a
generic `Responding...`. Partial reply text,
a transient output
preview, and concrete live tool activity are supporting context; none means the
active execution has ended. The row therefore keeps one explicit
`Working…` presentation and the same Stop control until an
authoritative terminal outcome replaces it. A transient output preview uses one
line as `Working… · <specific preview>`. Once the authoritative stream
is active, its other phases use the same hierarchy, for example
`Working… · Finalizing reply`; they must not replace the execution state
with the phase alone. The shared label describes request progress, not worker
admission. Queue position, input requests, blocked states, and diagnostics keep
their concrete meaning. When
the latest admitted semantic tool step settles, the live Work summary keeps its
concrete completed or failed meaning instead of inventing a generic
response-preparation phase. The message toolbar owns Message details. The Work
summary does not repeat that action. After completion, the durable message
toolbar still owns it.
The Space bootstrap snapshot seeds active stream projections in the same room
entry read as recent durable signals; Web must not issue a separate
conversation-state request. Web requests
`includeAgentStreamPresence=true`, uses the returned privacy-safe presence to
keep a thinking-only or tool-only Agent row visible on the first frame after a
refresh, and preserves its authoritative `createdAtMs` when later live frames
arrive. A missing presence field is a mixed-version response, not proof of an
active stream. Live frames update the seeded projection without overwriting a
newer sequence. A bounded reasoning tail can be replayed from the live Space
instance, subject to the existing audience and Local Agent owner preferences;
it is absent from durable bootstrap and browser caches.
Thinking and public progress keep independent bounded replay tails and client
sequence checks, so a later progress frame cannot suppress reasoning recovery
or a privacy-disable update. The same mounted conversation keeps received work
across socket replacement; access-revocation closes still clear transient work.
After tab suspension, probe the connection before declaring it stalled. Neither
stream recovery nor keepalive probes block history, bootstrap, or message reads.
A successfully published Agent reply may carry a durable
privacy-bounded work projection and public progress. Web renders the reply body
first and then one collapsed Work summary so historical steps cannot displace
the answer. Reopening it shows all retained grouped steps and public updates
inside the same bounded scroll viewport.
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
timeline position. An anchored `terminal_failure` row shows only
`{Agent name} couldn’t reply`, falling back to `Agent couldn’t reply` when the
target name is unavailable. The complete Core failure text remains in Message
details instead of expanding the source message bubble. Unanchored outcomes and
`wake_stopped` rows continue to render Core's `text` directly. Web uses
`reasonCode` only through the shared recovery mapping and uses `failureStage`
only to distinguish execution failure from OpenMeld publication failure.
Read-only viewers must still see the outcome.

Wake outcomes retain their message-scoped placement. System outcome rows reuse
the shared Marker separator presentation: centered text between neutral divider
lines, without an Agent avatar. Stops use muted text; execution failures use red
and publication failures use amber. The text still opens Message details when
available, and an authorized recovery action stays beside it. Source-message
failure footers remain compact request status rather than separate messages.
An Agent-authored explanation of a failed task remains an ordinary Agent reply,
with its speaker and message body. Never classify it by matching words in the
reply. Runtime-generated empty-reply notices are system outcomes, even when an
older envelope used an Agent author; their explicit metadata identifies them.
This presentation does not create another system notice or change cancellation.
Message details labels the persisted notice text as **Recorded outcome** and preserves
its full public explanation, including unfamiliar failure codes. Current
recovery eligibility supplies actions separately; it must not replace the
recorded explanation with a generic failure summary or imply that an old
setup instruction describes the Agent's current state.

A persisted terminal system failure is visible in that outcome row without
hover and remains visible when the timeline is loaded again after refresh. Its
Message details recovery is state-aware and must not reuse an Agent Profile
configuration action such as `Review agent settings`. Message details itself is
the diagnostic path: it renders the failure explanation in red and keeps
Technical details available without a duplicate `Open diagnostics` action. A
late result does not rewrite that failure's reason.
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
**Continue conversation** projection for a hosted empty reply: the saved
conversation prepares a reply with tools and Computer actions disabled. Web
uses the Core-provided label and warning. It preserves the terminal failure
rather than presenting retained evidence as an already-published reply. The
recovery notice never creates a second terminal outcome row.

A published `execution_recovery_completed` remains visible at its own timeline
position. When its author is an Agent, its saved answer uses the ordinary Agent
reply presentation; a system-authored completion keeps the system divider.
The same notice still closes the original request's recovery action. Message
details shows the recovered content, without substituting an earlier failure
from the same target. The original failure remains recorded in history.

While a requested recovery is running, Web shows **Preparing your reply…** and
polls the existing inspection endpoint. A failed status check retains an honest
unknown state with **Check status**, which only reads and never executes another
recovery. An exhausted hosted continuation disables further execution for that
original failure and explains that the message is saved. Historical
`remote_agent_failure` text signals with the exact empty-assistant error code
project as terminal failures, including **Failed** in Message details; their
stored history is not rewritten. New empty failures use system notices directly.

Message details presents one cause-specific primary action per failed target.
It must not pair unrelated actions: a Cursor plan limit opens Cursor plan
management, a setup problem shows the exact relevant setup action, and a
reply-publication failure shows exact reply recovery when available. The red
failure explanation and expandable Technical details provide diagnostic context
without a second diagnostics button.

The recovery action is owned by the exact
`dispatchId + targetProfileId + resultRef` key. Timeline, thread, and Message
details reuse that key and one deterministic operation identity. Only one CTA
for that key may be visible at a time: opening Message details moves the action
there and hides the timeline copy; closing it restores the timeline copy.
Pointer, touch, keyboard, and rapid repeated activation all enter the same
pending fence and issue one execute command.

For workstation Wakes, the user's source message enters the Space or Direct
Message timeline immediately. If the Agent Profile is occupied, the Wake status
under that message says it is queued and may include its position. Web does not
hold the message above the Composer or claim that the Agent is working before
the Wake reaches the Profile's current slot.

While an Agent Profile is working, Agent settings must state when a saved
change takes effect. Controller changes stay disabled because rebinding would
interrupt the current Wake. Model, reasoning effort, collaboration mode, and
OpenCode permission changes apply to the next Wake. Permission Mode timing
comes from the versioned Local Agent capability matrix: supported live updates
may affect later tool requests in the current Wake, while other controllers use
the saved mode on the next Wake. Web must not present a live update as applied
without the controller acknowledgement owned by the local runtime.

When a Local Agent or model provider returns a user-facing error, owner-only
Message details may show the bounded original text with its source label. Web
does not replace it with a large provider-specific translation matrix. It must
still hide secrets, stdout, stderr, stack traces, commands, local paths, and raw
payloads. OpenMeld-owned identity, security, routing, queue, and publication
failures continue to use precise OpenMeld-authored copy and one practical next
action.

Retaining a structured Local Agent error does not depend on OpenMeld recognizing
its category. Adapters preserve the safe original message separately from error
classification and diagnostic output; unrelated stderr must not erase an already
retained original error. This does not change Wakeability, provider-access
evidence, retry policy, or the execution's outcome.

A terminal execution outcome does not show an inline action that starts another
execution. Web exposes only exact result replay or exact conversation reply
recovery when Core authorizes those operations. To run the request again, the
user starts a new Wake through the ordinary composer so current Wakeability,
target, authorization, and client-message identity are evaluated afresh.
`Open diagnostics` expands and focuses the retained technical details,
including the bounded reason code, while raw internal error text stays out of
product copy. Outcome unknown never authorizes a second logical execution.

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

Web must preserve the submitted difference between Agent Wake, Agent Reference,
and Human Mention.

A Wake creates executable work. Reference creates Agent collaboration context,
and Human Mention directs a person's attention. Neither creates dispatch work.
Web must not silently rewrite one relation into another.

Ordinary Space, Direct Message, and Thread composers place a visible `@` button
beside the file button. Clicking it inserts `@` at the current selection and
opens the same picker without losing keyboard focus. The primary Space composer
uses `To wake an agent, type @, then pick the agent.` as its placeholder;
Human-only DMs use `Message {name}…`, Agent DMs use `Message {name}…`, Center
Agent DMs use `Tell Center Agent what you need…`, and Threads use
`Reply in thread…`.

New Codex and Claude tasks without an explicit access choice inherit the
Agent's current tools and permissions. **Limit task access** exposes bounded
Space-only, isolated-worktree, and supported current-folder choices. Isolated
Claude project work requires a committed Git repository and a running Docker
or Podman engine on the Agent's computer before the Wake starts.
**Choose Project and repository** resolves one Project and its configured
default, sole, or explicitly selected repository for that new task. The
selection travels as an accepted Execution Context fact, not as a change to
the Agent Profile's Default Project. The Service must find the matching local
connection on the Agent's computer or return a visible failure.

The Agent's Session options explain that automatic continuation can retain an
earlier session's restrictions. Message details shows the admitted task access and
workspace separately from the Service's new/continued native-conversation
observation. Missing diagnostics remain unavailable; the client never infers
network or GitHub access from a working folder.

For a recorded Space-only Wake, any member who can read the request and send
messages can review its shared file revisions and send it to the same target
as a new task under their current acting Profile. Confirmation explains that
the sender's permissions apply and the original requester's approvals do not
carry over. Normal authoring rechecks message, file, and Wake authorization;
the new task uses the Agent's current permitted settings and computer policy.
The confirmation also names the destination and possible repeated work. It uses
normal Space/thread authoring with a stable request id derived from the reviewed
source revision and content, requester, target and placement. Reopening details,
reloading, and retrying after either an uncertain or successful response reuse
that id. The existing Space authoring receipt deduplicates the recovery without
browser storage or a second server-side recovery store. Starting additional work
uses the ordinary composer. Main and thread recovery both require current message
permission, including when confirmation is already open.
The reviewed request is pinned even if details refresh before confirmation.
The action preserves the user's composer draft and never clears the retained
Context. Recalled sources, managed file handoffs and unsupported legacy
attachments do not receive an automatic request-copy action; the ordinary
composer remains available for a deliberately authored new task.

Draft editing and opening the `+` and `@` tools do not require permission to
send. The `+` menu explains why file selection is unavailable when uploads are
not authorized or a message is still sending. Send and upload authorization
remain unchanged. The Composer keeps its access explanation visible after text
is entered and offers the ordinary Human Join action beside the draft.
After account, Organization, and Profile identity are resolved, a Space mounts
its normal conversation Composer while entry, status, members, and history are
still loading. Restoring saved history must not block route entry. The same
editor stays mounted when the Space becomes ready, preserving focus, selection,
and editing history. Unknown membership is not a read-only verdict. Local
drafting remains available, while Send confirms current entry and posting
permission through the existing admission boundary. An explicit rejection
replaces the conversation with the existing access surface. Drafts keep their
existing account, Profile, Space, and Thread scope when navigating away and back.
Restored conversations expose an access-check retry even while the first request
is pending. Retry cancels that request and asks the entry resolver again; it
preserves the draft and never confirms access locally.

The `@` picker optimizes for the common user action:
selecting an Agent Profile authors Wake by default only when the current
Core-owned Wakeability projection is `ready`, or the canonical member projection
provides an eligible offline waiting target, while keeping the visible composer
text as a plain `@Name` mention. An unavailable or checking Agent defaults to
Reference unless explicit waiting is supported. Eligible offline Wake uses
`Wake when online` in the picker, token and relation menu. An offline state alone
does not promise waiting: it also requires the current server-projected target.
The same picker surface exposes the other allowed relation without a
required second dialog: Wake uses `@`, and Reference uses a link-style symbol.
Selecting a Human Profile creates a fixed Human Mention mark; people never
receive an Agent relation selector.

Agent picker rows reuse the Members availability dot after the name, from the
same Core-owned member projection. The inline relation control uses the compact
shared Fluid Select. Disabled Wake choices show the short availability label
(with action-only `Connect` rendered as `Unavailable`), never owner-assuming
computer instructions. Choosing a relation preserves the editing selection;
menu keyboard events must not send the message.

After selection, Web renders one persistent editable semantic control per
structured target. An Agent control places `@`, the Agent Profile icon,
canonical name, and the current Wake or Reference relation in that order. The
relation control sizes to its current label instead of reserving the longer
choice, while the name uses the remaining available width. Because every token
already states its relation, Web does not repeat the same information in a
bottom count summary. Human Mention tokens omit the Agent relation control. Web
provides a direct remove control for every Composer token in addition to
keyboard deletion. The control appears without changing token layout on hover
or keyboard focus and remains available on touch-only surfaces. Web submits all
structured relations explicitly instead of relying on Core to infer Wake from
arbitrary bare text. Changing a semantic control changes the authored structured
relation; AI interpretation must never silently rewrite it.

An existing or restored Wake draft remains a Wake while the user edits it; Web
does not silently downgrade the authored relation. Before every send path that
would create a new Wake, Web reads the current Core-owned Wakeability and blocks
before publishing the message or any Composer Upload when the Agent is not
currently ready or the read cannot be completed. Local optimistic feedback
precedes this check. Rejection restores the submitted draft if no next draft
exists; otherwise it preserves the next draft and marks the local message as
unsent. The Composer stays editable, and Reference authoring and ordinary text
input remain available.

Missing member data is separate from failed member loading. A draft containing
structured mentions keeps its text and tokens while the initial snapshot loads;
its send control waits without changing the Composer layout. A failed read
offers Retry. Ordinary text is not blocked by missing mention data. Composer
feedback stays inside the input surface without a separate bordered warning box.

Space live events refresh Space members in a bounded window, with one follow-up
when an event arrives during the read. The app-shell listener alone refreshes
shared Agent caches from account/organization-scoped browser invalidations.
Invalidation versions are compared within their Space. Owner-only readiness
reads never include another owner's Agent; those updates use the authorized
organization overview. Partial overview updates are tied to their live Query
instance and cannot overwrite a newer full response or a recreated cache.
The send-time fresh members read is admission evidence, not another display-cache
writer. Existing page freshness and bounded recovery timers remain unchanged.

The Composer member picker reuses the shared Fluid layout indicator for its
active row. Pointer hover and combobox keyboard navigation update that one
indicator through the same active-item state, so Web never paints separate
hover and keyboard backgrounds. Result groups keep deliberate row separation
and popover-edge padding rather than using each row's margin as layout.

The shared Web API client sends the current Space Addressing response-version
header, and the Web Gateway proxy forwards it unchanged. The live Space proxy
declares the matching `spaceMessageAddressing` hello capability. Therefore a
Human Mention remains structured after the optimistic message is replaced,
after refresh, and on live delivery; compatibility projection for an old client
must never run on these current paths.

Browser Composer drafts that can contain Human Mention use the version 2 draft
record and storage key. Current Web reads both version 2 and historical version
1 records, chooses the newest valid record, and migrates a selected version 1
record into version 2. It writes new drafts only to the version 2 key, so an
already-open old Web tab cannot parse and delete a current Human Mention draft
as invalid version 1 data. Sending, discarding, or clearing drafts removes both
versions.

For Web-authored Wake messages, Web must create and preserve a non-empty
`clientMessageId` before the first network hop. That key is the browser-authored
user-action key for later trace lookup.

One message can Wake multiple Agent Profiles. Wake details are therefore
target-specific once the target profile is known.

Message details is one controlled right-side drawer for every visible message,
not separate ordinary-message and work-message surfaces. The drawer reads the
shared Message Details response, builds one presentation model, and renders one
Activity timeline beginning with the actual message preview, author, and sent
time. The link section remains available even when the rest of the Message
Details response is loading or unavailable, because its destination comes from
the already-visible message identity rather than private detail content. Each
Wake target receives one Activity row. Transient work updates that
row in place while the target is active; the recorded reply, failure, stop, or
other terminal outcome then replaces the transient content in the same row.
The final status, reply preview, failure explanation, recovery action, and
diagnostic context stay together on that target row. Web must not render a
separate Replies section, a detached `Why this failed` summary, or an extra
`replied` event for the same final reply. Transient live progress can enrich
that presentation model but cannot become a second status source or final
outcome.

Visible originating Center Agent requests read the
optional Message Details delegation projection for a compact progress summary.
Message details expands the same projection into declared child rows and
completion ownership. Pagination retrieves additional declared groups independently
of the timeline window. Source/result links use in-view navigation only for
loaded messages; otherwise they use the canonical Space message URL.

Wake progress invalidations refresh Message Details, and visible active delegated
work refreshes through the same query. Reconnect and focus reread canonical
state. There is no additional client execution store. Graph reads the same query
and adds declared edges only when both authorized same-Space message nodes are
loaded; it neither invents missing nodes nor infers delegation from prose.

Spaces retain **Messages** and **Graph** as two views of the same
loaded timeline projection. The Space header's Graph entry is commented out
pending replacement with a board; Center Agent navigation is unchanged.
The product and implementation term is `Graph`.
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

At the latest messages, the Space header presents a two-row hierarchy. The first
row contains the Space name, access mode, and
right-aligned actions. The second row contains the available Space views
(Messages, Tasks, and Files) below the Space name. Those view labels align with
the Space name and use a flat active underline that overlays the header divider.
The Members action shows the active
member total from the Space member projection. The header and Space sidebar do
not repeat `Joined as` or an aggregate live-human count; speaking identity stays
with the composer when a choice is available, and per-member presence belongs
in the Members surface. When dismissed contextual setup remains recallable,
**Get set up** appears in the right-aligned action group immediately before
**Members**. On compact screens only, the same recall control may move to the
trailing edge of the second header row so the Space name remains identifiable;
it stays visually separate from the **Messages** and **Files** view control and
returns to the primary action group at wider breakpoints.

While reading earlier messages in a Space, scrolling at least 64 CSS pixels
away from the latest messages switches the header directly into one compact
row. Messages, Tasks, and Files appear between the sidebar toggle and the title,
separated from the title by a vertical divider. There is no entrance animation,
position transition, or scroll-progress interpolation, regardless of motion
preferences. The header expands only when the reader returns within 16 CSS
pixels of the latest messages. This distance hysteresis absorbs small scrolls
and avoids toggling at the threshold without a timer-based debounce.
The same layout applies inside Desk windows; width checks use layout coordinates,
unaffected by canvas zoom. Long titles truncate. Insufficient width and mobile
setup recall retain the complete two-row layout. Direct messages retain their
existing headers.
All Space views share the expanded/compact preference per Organization, Profile,
and Space. Switching views or replacing the message scroller rebinds input
observation without clearing the header layout or compensating the reading
anchor again. Only an actual layout endpoint change adjusts the message viewport.
Layout cleanup belongs to the header's lifetime, not to view changes. A new
preference starts expanded; obsolete intermediate-position preferences are not
reused. Tasks and Files do not drive compaction, and programmatic message
restoration does not count as user scroll input after rebinding.

Message-header visibility observations update the read-through scheduler directly rather
than publishing React state through the Space controller. Scrolling away cancels
the pending read immediately without rerendering the transcript. Space/Profile
changes require a fresh visible-message measurement; document visibility, access
confirmation, loaded Core unread targets, and a brief 150 ms dwell gate persistence.
Main conversations, Threads, and DMs share this observer. Unseen targets block
advancing the read watermark past them, and temporary progress cannot advance it.
After that dwell,
the existing optimistic Inbox projection updates before the server write settles;
failed writes retain the existing rollback and reconciliation path.
Web captures each main or Thread **New messages** divider from the first ready
Core unread snapshot for that visit, including an empty snapshot. Arrivals during
that visit never introduce a new divider. Clearing the entry batch removes its
divider without establishing another. A new visit or explicit unread navigation
identity captures a fresh boundary. The unread shortcut is hidden while a focused
main view follows the live end and all outstanding targets belong to that main
view. Older entry unread, scrolled-away updates, and Thread targets remain
discoverable. This presentation rule does not acknowledge anything; the visible
message observer and explicit user actions still own read receipts.
Thread targets open the exact reply instead of treating the root message as the
destination. One-to-one DMs omit redundant reply quotations; ordinary Spaces and
multi-participant conversations retain them.

When the main conversation has unread targets, the existing latest-message
control is also the explicit catch-up action. Web first reads a fresh Core Space
Inbox summary to freeze the accepted main-timeline cutoff, then mounts the live
tail and settles its scroll position before writing the main watermark through
that exact occurrence time. The activation reserves its history-navigation
revision before the summary read begins. A newer accepted history navigation,
unmounted view, or changed Organization/Space identity abandons the activation
before it can switch to the live tail or start the write, and discards its
unused cutoff. The same activation never advances a Thread watermark or
includes messages arriving after its cutoff; only an actual failed write keeps
the original cutoff for retry. Visible-message and explicit writes share one per-scope
serializer that coalesces queued higher watermarks, so an older invalidation
cannot replace a newer optimistic projection. Failures retain the cutoff for
retry and state that the user reached the latest messages but marking them read
failed.
Scroll events only check distance from the latest messages. Layout and preference
writes happen at the endpoint change, never per animation frame. The viewport
height changes once with a matching scroll offset to preserve the reading anchor.
A 4px collapse threshold and 1px expansion threshold avoid boundary oscillation.
Geometry is observed only on resize; there is no animation-frame loop or subtree
mutation observer.

Messages and files share one pinned-item preview with previous/next navigation.
The preview's X dismisses all pins for the reader; the original pinner gets a
Fluid dropdown with Dismiss and Unpin message/file. A Pinned action immediately
before Members restores the preview. Dismissal is saved per Organization,
Human Profile, and Space in this browser, without changing shared pin state.

Appearance includes Toolbar shortcuts for Computer, Center Agent, and Inbox.
All three default to off when no browser preference is saved. Existing saved
choices are preserved, and users can enable each shortcut in Appearance.
Each bottom shortcut also exposes a compact hide control on hover or keyboard
focus, with Undo. Touch users customize shortcuts in Appearance. Browser-wide
preferences apply on first paint; hiding all shortcuts removes the reserved
bottom row while retaining the normal page inset and the Sidebar footer.
Computer stays in the account menu above Settings. Its warning/danger avatar
and menu indicators consume the same shared current-Computer presentation as
the optional toolbar shortcut; hiding a shortcut does not clear attention.
The account menu's platform slot is reciprocal: Web shows Download desktop app,
while the shared renderer running inside Desktop shows Open web app and opens
the equivalent authorized route in the system browser. The slot remains above
Settings and does not create a second navigation or authentication authority.

Selecting a Human or Agent identity in a Space opens one compact profile
popover rather than a table-style details dialog. A Human popover shows the
short Space-specific activity time, such as **Here 2d ago**, from the Space
member projection in both the member row and popover; it does
not substitute Organization-wide last activity or generic presence copy. An
ordinary Agent popover may link its owner to the canonical Agent editor. The
Center Agent is not an ordinary editable Agent Profile: its Space popover has
no edit action, and its Chat action opens canonical Home instead of creating or
opening a Direct Message. When only historical message identity is available,
the compact popover shows that identity without the old details table, raw IDs,
or inferred current activity, Computer state, or ordinary edit/chat actions.
A recognized Center Agent may still open its canonical Home conversation.

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

Offline computer waiting uses progressive disclosure in both composers:
**Send and wait** replaces the primary send button for one current eligible
offline/reconnecting target, retaining the send icon and a compact 24-hour
explanation to its left inside the Composer. The current Agent Binding supplies the computer;
there is no device or deadline form. The deadline starts when the action is
clicked. Current admission still rechecks the frozen selector before publication.
Ordinary online Send and Reference-only authoring retain their existing meaning.
The timeline keeps waiting copy short, while Message details show its reason and
exact local expiry. **Cancel waiting** uses the existing projected Stop authority
and confirmation. Expired waits expose **Send again**, which prepares a draft
referencing the original message for only the expired Agent, without overwriting
another draft. A later send uses ordinary new-message admission and identity;
this UI does not redrive an expired or partly executed Wake.

Historical Wake recovery skips a source only when the existing shared terminal
matcher resolves every target from loaded durable Signals. Unresolved siblings
and outcomes outside loaded history retain recovery. Reads run in groups of at
most four, publish successful groups progressively, and are canceled when the
owning effect is replaced. Canceled or failed reads remain eligible for a later
recovery; cancellation never changes execution state.

Graph and Files code loads on first display. Graph presentation is derived only
while Graph is selected. Files image thumbnails enable their revision-scoped
content query only when within 100 pixels of the viewport; image-element lazy
loading alone does not control authenticated Blob downloads.

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
For workstation execution it is the Coordinator's first accepted running
lifecycle timestamp, never execution creation or time spent waiting for another
client. If older evidence lacks that fact, omit the timer.
`updatedAtMs` remains progress freshness and ordering evidence; Web must never
reinterpret it as the execution start time. A mixed-version response without
`startedAtMs` omits elapsed time instead of inventing a browser-local timer.

The existing Space/viewer progress cache retains minimal accepted publication
and terminal-progress evidence independently of message visibility. Closing a
Thread, cropping its two-message preview, or revisiting a route must not forget
that evidence. Explicitly different dispatch IDs remain different executions,
even for the same Agent and source message. Local pending identity may be
enriched by its matching dispatch, but a later identity-poor update cannot erase
an already known dispatch ID. Merge, final cleanup, visible work, Stop visibility,
sidebar status and activity destination selection respect this boundary.

The evidence shares the presentation cache's 30-minute inactive GC lifetime;
sidebar and Desk readers observe that same cache without adding network reads.
Summary requests carry the cache lifetime they started in, so a cached summary
or late response from a retired lifetime cannot re-enter a new one. Reply-stream
bootstrap seeds must come from a read in the current presentation lifetime;
older display caches cannot seed working streams after completion evidence has
been collected. Live Thread progress is never stored in retained Thread history
or previews. Accepted outcomes also suppress replayed streams for that execution.
Evidence is not persisted and contains no message body or Stop permission.
The same in-memory presentation lifetime retains received reply-stream content
across route changes. Stream text is not written to persisted history or browser
storage. A pending membership read does not clear it; explicit access rejection
does. Published outcomes still suppress the matching stream.
Received Markdown does not replay per-word entrance animations on route return;
new text retains the shared pacing behavior and reduced-motion preference.
An active-Wake response received within the existing 30-second Space snapshot
window remains usable during a return visit's immediate revalidation. Older
responses and retired presentation lifetimes cannot restore controls. Core
still checks current Stop authority on each request.
The same short return window retains this viewer's local `sending` or
`request_sent` submission before a dispatch is assigned. It never promotes a
cached execution to running or extends the existing local submission expiry.
Neither snapshot omission, stream disappearance, ordinary Agent text nor human
follow-ups establishes completion. Failed, stopped, publication-unknown and
published outcomes retain their distinct meanings; Core still owns execution
and viewer-authorized Stop policy.

If Web presents a Wake restored from its local progress cache, an unverified
active-summary cache, or a main-conversation stream seeded from an unverified
bootstrap, without a matching current Core active-Wake read, it sends one
bounded browser diagnostic through the existing application-error intake. The
structured `web.openmeld.wake_progress_presentation_unconfirmed` log identifies
the Web build, Space, Wake correlation pointers, source/reply Thread pointers,
progress update time, phase, cache source, and which queries have fetched since
mount. It never includes message text, target
labels, prompts, or arbitrary browser state. This is an observation of what
Web showed, not proof that the Wake is stale; agents use the dispatch trace to
determine the actual outcome. Delivery is best effort. Normal newly submitted,
freshly streamed, and currently confirmed Wake progress does not produce this
diagnostic.

Web explicitly requests the bounded controller-conversation occupancy wait
reason with `includeWaitReason=true`. When Core projects it, Web shows `Waiting
for <Agent name>` and explains `Another app is using this conversation.` The
waiting action uses `Cancel waiting`, with the same authorized cancellation
path as Stop. It must not present that state as `Agent is
working` or the generic `Sending to agent`. The current Space's secondary
sidebar status uses the same progress projection and a non-Working waiting
indicator instead of its animated Working orb. Both surfaces return to ordinary
Wake progress as soon as Core projects the conversation as available.

Web uses the shared Wake presentation resolver for status text and Orb variants.
When current Core projects `remote_agent.execution_confirmation_pending` on an
active native Wake, the shared resolver shows **Result awaiting confirmation**
with a neutral pending appearance. It suppresses stale tool-work previews and
elapsed-working presentation, explains that later work may be waiting, and
retains the existing viewer-authorized Stop control. It never infers a failed,
completed, or not-executed outcome, and it does not offer automatic resend.
Sidebar priority is input needed from the current user, then working/replying,
then sending/connecting, then queued or waiting. Equal priorities retain Wake
start order. Other active Spaces in the selected Organization reuse the same
authenticated active-progress query and cache on the ambient 15-second refresh
cadence; this does not claim open-Space WebSocket latency. A failed read retains
only the account summary's generic active indication, not a guessed phase.
Bounded summaries disclose additional active tasks. Reduced-motion and
input-waiting Orbs are paused.

Unfinished Agent replies follow the latest message in their owning conversation.
The server-selected `replyThreadRootSignalId` takes precedence over the trigger
message's location once reply placement is known. Before selection, execution
progress keeps its source context, including shared-Space Center Agent Wakes.
The unfinished reply immediately shows the same authoritative progress as the
sidebar and admits public work even before its final destination is selected.
Native execution timing survives both outbox and dispatch-ledger projections,
so the reply's elapsed time comes from its runtime's accepted execution evidence.
Transient thinking and progress never allocate a reply Thread. Existing
Thread work can use its source Thread context before an answer stream arrives.
For a Thread-bound reply, the main message's **Open thread** entrance shows the
compact current phase and authorized Stop control in place. The Thread shows the
complete progress and its Stop control. The main message does not show a second
working row or Stop. A durable Thread reply preview replaces the compact phase,
including when an older active-progress snapshot has not refreshed yet. Durable
outcomes fetched in Thread history or previews reconcile the same Wake
presentation as live outcomes.

Thread entrances retain the viewer's existing Inbox unread targets. Their
preview rows support pointer and keyboard activation without intercepting real
links or text selection. Previews show the latest two replies in chronological
order. Hover/focus warms the same profile-scoped message query used by the panel;
a saved panel warms alongside Space loading after account cache activation.
Prefetch does not acknowledge unread messages. A short freshness window avoids
an immediate duplicate read, while live-only partial snapshots remain invalidated
until a complete Thread read succeeds. Loading messages is visibly indicated.

Main Space and Thread use the same presentation-only ordering: published history
keeps its server order, followed by active Wakes in request order. A public reply
stream replaces its matching placeholder; it does not add another status row.
The final durable reply takes its published position. Durable outcomes and
temporary streams reconcile by their shared
`dispatchId`, never by guessing the stream ID from a client message ID. The
placeholder, stream, and final answer keep one React display key for that Wake;
durable Signal IDs remain unchanged for reply and message actions. Spaces,
direct messages, and Threads consume this same timeline projection. Failures
and stopped outcomes keep their original request context. Active rows expose a request link
and reuse the shared status, Orb, preview, and Stop controls, without message
timestamps or publication actions. Missing source history does not hide a Wake
whose authoritative source context proves its conversation scope.
Stopped outcomes use the target Agent's reply surface with the original request
preview and a quiet `(Request stopped)` label below any retained public reply text. An
empty response still shows `(Request stopped)`. They are not grouped across Agents or
rendered as full-width system separators; partial text survives history reload.
Core-published native failure and cancellation text (`remote_agent_failure`)
replaces its exact submission's temporary stream, just as a successful final
reply does. A late or stale stream must not retain a working or failed bubble
beside that durable outcome. Other submissions remain visible.
In local development, `message-state-preview=reply-race` replays placeholder,
Local Agent stream, durable answer with a still-open stream, and stream cleanup
at ten-second intervals through the shared timeline and conversation projection.
It is presentation-only test data, available on Space and direct-message routes;
it does not dispatch a Wake or change runtime state. Reload to replay it.
All Web progress reads request `includeSourceContext=true`. Thread rendering
uses the same recovered presentation snapshot as the main conversation, filtered
to its own Thread; the root message does not import main-conversation controls.

Stop confirmation is owned by the conversation rather than a movable message
row, so progress updates and streaming replacement do not dismiss an open
confirmation. The existing selector and Core eligibility remain authoritative.

The Composer provides an offscreen bookmark for active Wakes started by the
current Human Profile in this Space. It reuses the same presentation snapshot,
status resolver, and Orb as the conversation. The own-work query applies
`sourceProfileId` before the server's bounded result limit, and live invalidation
refreshes both filtered and unfiltered summaries through their shared key prefix.
Viewport visibility changes placement only, never execution state. A readable
working status hides its matching bookmark. Mounted rows do not acquire an
offscreen bookmark until the observer measures them after scroll restoration.
The first measurement applies immediately. A short
visibility delay and separate
enter/leave thresholds avoid flicker at the scroll boundary. One bookmark jumps
directly to the working status; multiple bookmarks open a stable-order list with
request previews and Thread attribution. An open list updates state in place and
disables finished entries until it closes. The main Composer summarizes work from
the entire Space except the currently open Thread, whose Composer hosts only
that Thread's work. Closing the Thread returns its bookmarks to the main summary.
Thread bookmarks identify their scope and open the owning Thread before focusing
its working status. Navigation preserves text drafts and blocks a Thread switch
that would discard pending attachments.
Pending Actions retain their
existing ownership and controls. Reduced motion disables the bookmark transition.

Web derives message-level progress, the details drawer, and Space-level current
work from the same shared Wake progress item. It must not introduce a second
resolver that independently combines dispatch, RuntimeCoordinator, native
delivery, or reply state. The shared item may include opt-in Space-owned public
source context for later presentation, but this contract change alone does not
add a new visible UI surface.

RuntimeCoordinator progress changes reach an open Space through the
`wake.progress.changed` WebSocket invalidation. Web treats that frame only as a
targeted prompt to refresh the active Wake progress query; the frame itself is
never rendered and does not own state. Mount, browser focus, and reconnect also
refresh the authoritative snapshot. A 15-second initial and 30-second ongoing
detail refresh remains only as missed-frame recovery, not the normal live-update
path, and must not trigger unrelated members or Space-status reads.

Web explicitly requests `includePreviewText=true`; the resulting optional
`previewText` is the only Wake-progress evidence it may render as a live reply
preview. Core omits that field for clients that do not opt in, which keeps
rolling strict clients compatible. A `writing` phase without `previewText`
renders the ordinary concise `is replying` status instead of displaying the
shared diagnostic `message` as if it were Agent output.
Any UI that summarizes the active list requests `includePageInfo=true` and
treats `hasMore=true` as incomplete coverage (for example, `25+` rather than an
exact count). It must not imply that the bounded first page is the complete set.

When active Wake progress includes a pending Agent Interaction for the current
Binding owner, Web partitions requests by their authoritative source Thread ID.
The active Thread Composer shows only that Thread's requests. The main Composer
keeps main-timeline requests and entry points for requests in other Threads.
Opening an unrelated Thread never moves those requests into it. A Thread entry
opens its owning Thread and expands the selected request; the request is then
removed from the main surface, so its approval controls exist in one place.
The surface reuses the existing Permission, Question, and Plan Review
cards, stays closed until the owner opens it, and presents multiple requests one
at a time. Its selection and component identity use
`runtimeCoordinatorExecutionId + interactionId`, because separate Wakes may
reuse the same provider interaction id. Web does not create a cross-Space
approval center, duplicate pending state, batch approval, or an automatic
popover. The originating message or thread remains context, not the location
the owner must rediscover to respond. Other members continue to see only the
safe inline waiting indication.

Recipient-owned Plugin action approvals use the same Composer tray and its
selection, disclosure, focus, and Thread routing. Their stable identity is the
Plugin request ID, not a fabricated Wake interaction. The pending Space query
does not depend on loaded messages; scrolling away from the source cannot
remove an unresolved request. The original message and Inbox retain the same
request-backed card for context and decision history. Approving or declining
invalidates the pending projection. Main messages that have a reply Thread stay
in the main tray; only actual Thread replies belong to that Thread's tray.

Agent access requests in a Space use two presentations of one Core request
state. For the Agent owner, a pending request appears at the end of the
conversation as a request preview: it reads like a message from the requested
Agent (its avatar and name, `Not in this Space yet` in place of a timestamp)
but is never a published message. It explains the request and holds the
decisions: the first Core decision is the primary button, and the rest sit in
an overflow menu. For a member's Space request the overflow starts with
`Message <requester>`, which opens the owner's Direct Message with the
requester and leaves the request pending. The preview uses the Agent message
avatar and the message bubble radius with a dashed border. A one-line Agent
requests bar above the Composer repeats the summary and the same actions; while the latest messages are shown, its text
scrolls to the preview. The requester
sees only the bar, with `Withdraw` while the request is pending. Composer trays
stack top to bottom as Agent requests, pending Agent actions, then queued
messages, each tucked under the next with the same inset, and an answer from
either presentation disables both.

Permission cards show the native choices; question cards collect every answer
in bounded steps; plan cards show the bounded plan and support approval or
change feedback. Web posts the shared response to the Space interaction
endpoint, disables duplicate submission while it is pending, keeps a failed
submission retryable, and refreshes authoritative progress after every attempt.
A transport timeout, lost connection, invalid receipt, or server error leaves
the outcome unconfirmed. Web makes one bounded confirmation attempt with the
exact original response, using Core's retained receipt. It never repeats a
permission-setting mutation during confirmation. If confirmation also fails,
the card shows neutral `Response not confirmed` feedback and a `Check response`
action that resends the same answer. Explicit rejections remain errors. Web
does not continue the Agent or claim acceptance from an absent pending card.

For controllers with a native low-interruption Permission Mode, a permission
card may also offer to save that mode for future requests. Web first saves the
selected Profile setting, then attaches its Binding reference to the permission
response. If the setting cannot be saved, Web keeps the request actionable and
does not send the approval. Response confirmation reuses that saved reference
without saving the setting again. A saved Binding intent does not by itself
prove that an active local Agent has applied the mode. Web does not invent a
generic mode for controllers such as OpenCode that
own a different permission contract. High-trust modes require explicit user
confirmation.
The ordinary approval card does not include a separate Profile settings button
or a standing explanation of permission synchronization.

Only `canRespond=true` plus a non-null private request may render details or
controls. A content-free summary renders only that the Agent Profile is waiting
for its owner. Web must not infer owner authority from Space role, Profile
selection, or cached UI state. Secret questions use a password input and must
not be echoed after submission.

Detailed Wake polling must merge changes to `pendingInteraction` even when the
ordinary lifecycle phase and `updatedAtMs` are unchanged. Across the Space
summary and per-message copies, Web relies on Core's `updatedAtMs` already
including the interaction revision (see shared contracts); it must not add a
client-side tie-break that prefers either source's `pendingInteraction`. An unexpired
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

Web opts in to `wakeStopEligibility` when reading Wake progress and active Wake
progress. This is a viewer-scoped Core projection: only the Wake requester's
account or the target Agent Profile's owner, with writable Space access, may
receive Stop eligibility. Null or missing eligibility hides Stop in the timeline,
details, and multi-target controls. A sent message, its age, a previous Stop
response, and other accounts signed in on the same computer never grant Stop
authority. Progress caches remain scoped to the current acting Profile.
Core rechecks the same authorization rule on every Stop request before any
pre-agent, controller, or native-delivery cancellation. Web must not infer
stopped, cancelled, or controller support from local browser state or labels.

The Wake Stop request path is `POST /v1/spaces/:spaceId/wake-stop`. Web sends
only `sourceSignalId` or `clientMessageId + targetProfileId`, never
`dispatchId`, task ids, or RuntimeCoordinator execution ids. A typed
`unsupported`, `not_stoppable`, `not_found`, or `retry_later` response is product
state. HTTP 403 with `space.wake_stop.forbidden` means the current account is
neither the requester nor the Agent owner. A raw HTTP 404 is a route/deployment/proxy
problem, not normal Wake Stop unsupported behavior.
For `retry_later`, Web says that OpenMeld could not confirm Stop and offers a
retry. The response alone does not prove a local Service connection failure:
native Hosted Agent cancellation can return the same status.

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

The global Agent creation page presents an immediate local sending state, then
tracks the exact durable Core request by ID. It retains an unacknowledged
idempotency key across reload and reuses it for the same intent. The status
steps show only confirmed request, identity, and setup milestones; they do not
infer Wakeability. A completed self-request opens the canonical Agent Direct
Message by default, or the requested Space after membership completes. The
page does not wait for Team directory refresh before navigation and does not
interrupt someone who has already left it. Creation history remains available
for approval, failure, and recovery. A Local custom working folder stays with
the idempotent creation intent until the exact accepted request is known; on
reload, the same-tab draft is restored before final setup. Other compact
creation entry points keep the same durable request and local intent semantics.

Confirmed Space deletion intent immediately closes settings and opens Browse
Spaces. Keep only the affected Space absent from list caches while the write
is pending, including during background refetches. Failure restores that entry
without replacing unrelated newer list changes and leaves a persistent error
with an Open Space action. A refresh failure after confirmed deletion must
never restore the deleted Space or report the deletion itself as failed.

Agent creation hosts the shared Computer setup workflow inside its existing
form as soon as connection or reconnection is required, without an extra
Connect or Reconnect click. Missing connection or a
failed connection check hides the configuration controls and replaces the
disabled submit dead end with the connection workflow, even when an older local
agent catalog is still cached. An enrolled Computer is described as already
added but currently disconnected; a failed read never claims disconnection.
Connected computers with no selectable local agent show the shared Local agents
installation empty state: a dashed border, supported-agent names and icons, and
the installation guide in a new tab. They do not mount computer connection setup.
Check again refreshes that computer's local-agent catalog before continuing.

The parent creation form stays mounted through setup and back navigation,
preserving the name, settings, and original Space membership context. Embedded
setup consumes a fresh-session intent locally, never by navigating the host
page. Its completion callback fires once per verified Prepare Session after
the owning readiness refresh succeeds. Creation selects the returned device
and lane, rereads its catalog/readiness, and still requires an explicit Create
Agent submission. It does not infer Wakeability or publish a Space reply.
An enrolled selected computer going offline must not silently move the draft
to another available computer. New-computer setup is a separate explicit action.
Required setup has no back-to-configuration action while the computer remains
unavailable. Optional new-computer setup can be cancelled. Space-originated
creation retains a visible outlined back button with a left arrow to return
to the people-and-agents picker.

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

While that exact Prepare Session is active, Web may render the latest structured
connection-progress observation carried by its existing Prepare stream. Web
must fence observations by session, operation, attempt, and sequence; a stale
observation cannot replace a newer attempt. Measured transfer bytes may render
a percentage, while other phases remain indeterminate. The observation never
advances Prepare, changes its success criteria, or substitutes for its canonical
terminal snapshot. Desktop may open the organization Connect route with one
explicit non-secret Prepare Session ID so the signed-in owner can observe that
same session; this route reads and subscribes only, and does not create another
Prepare Session or mint setup authorization. When the observation stream is
reconnecting, Web retains the last confirmed stage without animating it as
fresh work.
Exact-session observation remains read-only across initial load, snapshots,
refresh, reconnect, and not-found handling. It neither reads nor overwrites the
ordinary Connect flow's persisted session pointer and exposes no command,
authorization, or start-over mutation. If the named session expires, Web keeps
the observer on an unavailable state for that ID; beginning a new connection
requires explicit navigation out of the observation URL. Progress is accepted
only for the Terminal epoch in the current snapshot, so a replaced Terminal or
completed session cannot be reactivated by a late frame.

The standalone native Desktop Computer page centers its card below Back within
the existing app-shell scroll content; it does not introduce a fixed viewport or
nested scroll area. Only the icon-only Back link is square and circular, retaining
shared focus and touch sizing. Text Back, browser setup, New Agent embedding,
Space recovery, update flows, and exact-session observers retain their original
layout and navigation context.

The native page explicitly presents its first unknown connection check. A
same-account native display snapshot stays usable during ordinary background
refetch; missing identity/target and active mutations still block submission.
Display caching never authorizes a mutation. Each observer belongs to its full
account/request context, and each manually submitted operation has a local
observation revision. Remounting resumes the native owner's pending operation;
old requests, a delayed current-operation read, duplicate settlement, and late
pending cannot complete or relock a different request. Disconnect consumes the
same native record rather than replaying retained connect success. Confirmation,
cancellation, completion, and unconfirmed outcomes retain their distinct meaning;
refresh warnings do not erase confirmed native completion. Historical update
failures and Skills advisories remain independent from the Computer card's
Core-owned current Service liveness projection.

When setup starts from `Reconnect Computer` on an existing Computer,
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
preserves same-controller Binding settings and conversations, keeps each
Profile in its canonical Organization, and reports partial success honestly.
It is a user-confirmed convenience over per-profile writes;
it is not an automatic side effect of service setup, Computer reconnect, or
device-name matching.

An accepted Agent Profile Binding reconnect is a completed cloud save. Web must
not report that save as failed because route-catalog notification or
the compatibility `AgentExecutionReadiness` projection has not converged within
a browser-side polling window. Core owns the route-catalog notification issued
with the Binding write;
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

The Website owns the single account-free download page at `/downloads`.
Web's legacy `/desktop` route redirects there, preserving the raw query and
fragment. The account menu links directly to the Website page.

Web owns anonymous `GET /desktop/releases.json`, a read-only projection of the
existing `OPENMELD_DESKTOP_DOWNLOADS` store. The shared download schema covers
version, platform, size, derived download path, and release notices. It reuses
the manifest and artifact-size checks used by the existing download route.
A strict `candidate` selector chooses only that candidate. Missing, invalid,
repeated, mismatched, or corrupt selectors never choose a promoted replacement.
The default projection reads each platform's existing promoted release, with
the existing explicitly labeled unsigned Windows x64 internal preview when no
promoted Windows x64 build exists. It does not publish or promote artifacts.

Website reads this projection through its fixed App service binding. Its
platform cards retain version/file-size information, installation instructions,
and Windows notices, including unsigned-installer and automatic-update limits.
macOS is not labeled Preview. Windows is labeled Preview under the current
release policy. Candidate views remain noindex and show only the selected build.
Missing metadata offers no download; storage or schema failures produce an
unavailable result rather than invented version information.

Web must deploy this additive reader before Website uses it. Existing
Desktop download/update protocols, CLI, Service, managed Skills, Core, Gateway,
setup, Wake, Space actions, and diagnostic contracts remain compatible.
No local-component contract bump is required. Rollback removes the Website
caller before removing the Web metadata endpoint.

Validation covers default and exact-candidate projections, strict selectors,
artifact size mismatch, unavailable builds, redirected legacy links, and
narrow/wide page layouts. Download and update endpoint contracts remain unchanged.

Web must not claim setup success because the app was downloaded. A local Wake
still requires computer/agent setup and a reply or explicit outcome through the
existing OpenMeld Service and Space owners.

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
verified raw executable. Windows x64 binary setup downloads the CLI and native
process companion, verifies exact size/hash and Authenticode publisher for both
on the signed channel, and follows the shared installer's receipt to the managed
command. A separately published internal Windows x64 preview can use explicit
unsigned metadata and an exact preview manifest URL for known coworkers. Its readable
PowerShell 5.1 command contains setup's exit and environment in a child shell;
the caller's terminal remains open. Windows setup still requires the selected
channel's manifest and all three artifact bytes to be published before sharing
the command; a Web deployment alone is insufficient.
Explicit `?dist=npm` remains the package distribution. The bootstrap is only the
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
`npx -y openmeld@latest` only for explicit `?dist=npm` or npm recovery.
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

Web setup, Computers, and Profiles surfaces use the shared Local Components
action vocabulary for local recovery CTAs. User-facing entry points say
`Connect Computer`, `Reconnect Computer`, or `Update OpenMeld on Computer`;
they do not require a beginner to understand the OpenMeld Service process.
Computer detail, version checks, diagnostics, and other component-specific
surfaces may still name **OpenMeld Service**. The computer connection comes
before local-agent binding; only after it is usable should an Agent Profile
binding problem show `Connect local agent`.

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
**Check delayed** outcome on the affected local-agent row, the current Computer
summary, and current-Computer toolbar attention. The local-agent card footer
shows the last trusted check as concise relative copy such as **Checked 3
minutes ago**, with the same evidence repeated in its detail dialog. Only an
affected controller offers the quiet **Check again** action; routine automatic
retries do not add a global recovery button. A delayed check never becomes a
red repair alert, whole-computer reconnect instruction, or setup action.

The current-Computer toolbar keeps that coarse warning or danger attention
stable while page navigation or a full browser refresh revalidates current
inventory and readiness. During a cold reload it may paint the validated
account-scoped display snapshot, but it must not create a Computer detail link
from that snapshot. Live inventory must match the snapshot's opaque device id
before the hint can bridge the readiness load; a device mismatch or read error
removes the hint, and the next successful Core readiness result replaces it.

Computers applies the same severity boundary to controller account states.
Signed out and provider access unavailable are non-runnable `Unavailable`
states: keep the local-agent logo and name muted, use neutral or amber status
copy, and show the accurate provider-account next action. Red `Error` remains
reserved for a real launch or controller failure. Another member's Computer
uses the same presentation from the team-safe projection; Web must not infer a
different severity from missing private account detail.

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
surface. Current status and the next action stay visible; Service, CLI, and skill
versions live under a collapsed **Versions and details** disclosure. Historical
environment reports live under **Connection reports**, not repeated status cards,
and are explicitly not evidence of a current connection. The Computer detail
automatically selects its sole live connection when there is no explicit choice;
multiple live connections still require a choice. An explicit selection that
disappears must not silently switch to another connection. The card
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
card shows one capability-gated **Automatic updates** switch and
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
verified update completion. An exact target observed while the same operation
is still `waiting_for_work` or `updating` remains **Updating**. Only `updated`
plus the exact target Service and CLI becomes **Up to date**. `restored` and
`needs_help` remain **Update failed. Try again.** even when stale component
fields match the target. An optional update still available after completion
prevents **Up to date** from becoming a false current-version claim. Computer
connection recovery remains explicitly
**Connect Computer** or **Reconnect Computer**. When Service is offline,
both the card action and its More menu use **Reconnect Computer** and open the
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
the CLI and Service projections both report current, unblocked, installed
versions. An optional update still available is not a completed update.
Missing or unknown projection data is not success. If the bounded
verification window expires, Web shows an explicit unverified outcome instead of
a completion checkmark or an endless spinner. Missing evidence alone must not
be attributed to a release-side failure.

The human-facing command is the Web-generated setup command. On supported macOS
and Windows x64 it selects binary setup. For explicit `?dist=npm` or npm recovery,
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

## Wakeability And Recovery Presentation

Web may display Wakeability on Agent Profile and Space surfaces, but it
does not own execution truth.

Final user-facing Wakeability must come from the Core-owned Wakeability
projection. Web must not reconstruct it from local browser state, Space
membership, Binding existence, route-online evidence, service health, setup
completion, Agent Activity, one Wake's Outcome, or capability inventory. The
current compatibility APIs and types may still use readiness or execution-status
names, but those names do not create another authority path.

Web may briefly refresh local owner diagnostics when Core reports checking or
self-healing evidence, but that refresh behavior must have an explicit
expiration boundary. After the refresh window or attempt budget is exhausted,
Web must stop presenting transient checking as the public state and must return
to the latest Core-owned Wakeability or owner recovery guidance. It must not
keep a last-known `Available` badge when the current Core projection says the
route, service, or execution path is no longer available.

The Space Members surface may use Core/Space active Wake progress read models to
show that a target Agent Profile is actively running or waiting for OpenMeld Service,
even when the latest member Wakeability row is stale or degraded. That overlay
is presentation-only evidence for one active Wake. It must not become final
Wakeability, recovery eligibility, Binding truth, member sorting, mention
authoring, or Profile Details truth.

Visual smoothing for brief `checking_connection` flicker may replay the last
`Available` presentation only for the compact row indicator and its accessible
label, and only inside a bounded debounce window. Terminal `offline_for_wake`
or `unavailable_for_wake`, cold-start checking, recovery actions, diagnostics,
Profile Details, sorting, and command eligibility must continue to read the raw
Core/Space snapshot.

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
next step. It does not decide Wakeability or execution truth.

Profile and Space recovery resolve the same shared reason-to-action mapping.
Missing or invalid folder and Project connections open the existing owner
working-folder dialog. Authentication, installation, disabled local agents,
and missing or stale controller reports lead to the relevant Computer controls.
A missing report is not a missing connection. Only connection actions carry
the compact **Needs connection** label; other actions use **Needs attention**.
The dialog freezes its canonical Binding and exact Computer/lane, reads current
saved configuration, and retains its draft through refreshes. Space adapters
provide their editing context to the shared Profile action; they do not create
a separate recovery form or configuration authority.

Known blockers name the affected object and place the action beside the
explanation. Computer recovery uses **Connect computer**, **Reconnect
computer**, or **Update** with copy such as **Felix's MacBook Pro is not
connected.** or **Felix's MacBook Pro needs an update.** Primary blocker copy
does not say `needs setup` and does not use `Review setup`. Setup language remains
appropriate only when the destination is an actual multi-step setup flow.

When a Wake failure maps to a computer-connection recovery action, Web may show
a local repair entry only when the failed target is manageable by the current
user. For another user's computer, Web should explain who needs to reconnect
the computer and check the local agent instead of linking the current user to a
repair surface that cannot fix that target.

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
- `developing/product/routines.md`: Routine and Run semantics,
  authority, scheduling, and result surfaces.
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
- Final Wakeability must come from the Core-owned Wakeability projection.
- A visible Wake problem should end with a clear outcome, one next action, and a
  diagnostic path, not internal subsystem vocabulary.
## Computer session history

The owner Computer connection menu offers **Disconnect Computer…** when an
exact device and runtime lane are resolved. It shows a copyable, account-bound
CLI command to run on that Computer. Copying does not execute the command or
change connection status. The CLI owns controlled Service shutdown and local
credential cleanup; the cloud Computer record, Web session, and Desktop session
remain. Other members' Computers do not expose this action. New Web guidance
requires publication of the additive CLI options described in `cli.md` first.

Computer owners manage Session history access beside File access. History starts
off, requires selected connected Projects, and optionally permits selected
Agents. Settings are acknowledged by the live source Service; offline edits
must not appear saved. Save uses the last policy revision and requires reload
after a concurrent change.

Owners can browse current Codex sessions and read message pages, including
sessions without a Profile. Private results use component memory only, never
the persisted query cache or route loaders. Access history is owner-only and
contains request metadata, not conversation text. Clearly disclose that Agent
conversations and model providers can retain returned results.
