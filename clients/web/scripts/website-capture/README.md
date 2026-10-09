# Frozen Website demo

Build-time reuse keeps the Website honest without tying its release to every
App UI change. The source composes actual Web and shared UI components. The
Website publishes the resulting static artifact, not a second product app.

## Provenance and refresh

This revision starts from product UI at `82e7d9f51` on origin/main. All sample
people, messages, files, Skills, and Routine results belong to a fictional team.
Amplift appears only in the organization switcher; public-facing demo labels use OpenMeld.
No production account, captured conversation, or private asset is included.
Human avatars use local Pexels stock portraits. Photo credits, license, and
fictional-profile usage are recorded in [avatars/SOURCES.md](avatars/SOURCES.md).

From the repository root:

```sh
pnpm -C clients/web exec vite build --config scripts/website-capture/vite.config.ts
pnpm -C clients/website dev
```

Review `/product-demo/index.html?scene=Conversation`, `Spaces`, `Files`,
`Skills`, and `Routines`, plus focused `CreateAgent`, `Knowledge`, and
`Schedule`, `CenterAgent`, and `Usage` scenes and the embedded homepage at desktop and phone
widths. Commit the builder and regenerated `clients/website/public/product-demo`
together. Ordinary Website builds never refresh this artifact. Revert those
files together to restore a prior version.

Append `&theme=light` to preview the same product components in light mode.
The default remains dark for the homepage embeds.

Refreshes keep the current entry and hashed assets available while building.
The builder writes new assets first, then atomically replaces `index.html`.
A failed build therefore leaves the previous demo usable. Old hashed assets
remain available for already-open demos; remove obsolete assets only when the
preview server is stopped, before a clean artifact refresh. Do not run multiple
demo builds against the same output directory at once.

## Real component owners

- Shell: `AppSurfaceLayout`, `AppRailNavigationGroup`, `ConversationsSidebar`,
  `PeopleSidebar`, and `SpaceWindowHeader`. The harness composes their slots.
- Spaces: `SpaceDirectory`, message primitives, `SpaceAttachmentFileCard`, and
  `SpaceComposer` with the real editor. Threads reuse `ThreadPanelHeader` and
  `SpaceInlineSidePanel`; the compact reply preview adapts the product's private
  `ThreadPreview` markup without its live queries.
- Rail: `OrganizationSwitcher` with the shared pointer-reactive O avatar,
  `SidebarUserFooter`, and `DitherProfileAvatar`.
- Inbox: `InboxPage`, its feed, filters, item menus, and read-state mutations.
- Team: `TeamHeader`, `TeamHome`, `DirectoryHumanProfileDetails`, `AgentList`,
  `AgentProfileSidebarItem`, `AgentProfileWorkspaceDetail`,
  `OrganizationPluginsPage`, `OrganizationSkillsListPage`,
  `OrganizationSkillDetailPage`, `FileSystem`, and `RoutinesPage`.
- Interaction primitives: existing `@openmeld/ui` Fluid and Base UI components.
- Create Agent: shared `AgentRuntimeChoice`, `LocalAgentSelector`,
  `AgentNameEditor`, and `PersonalRemoteAgentConfiguration`. Remote provider,
  model, reasoning, and avatar presentation use the real product controls and
  the bundled `release/vendor-models.json` catalog. The five header logos are
  supported examples from that catalog; xAI remains selectable in the model
  picker. Selection and naming are local; there is no creation submission or
  connection to the visitor's computer.
- Center Agent: the real `AgentAvatarEditor`, `HostedModelSelect`, and Agent
  configuration cards. Its initial model is GPT-6 Astra. Avatar preview/save
  is shared across the same tab's demo frames through a dedicated sessionStorage
  key; model selection remains in memory. Connected apps and Channels are
  fictional readouts using the public catalog's shared logos.
  The initial avatar is the Original blue clover, and the settings card shows
  OpenMeld with the handle `@openmeld`.
- Usage: the real `RemoteUsageCard` and `LocalAgentTokenUsageCard`, including
  their shared ECharts SVG charts, Fluid scope tabs, Details accordions, period
  selection, and tables. Refresh is hidden through the cards' `showRefresh` prop.
  Numeric fixtures pass `aiUsageQueryResponseSchema`;
  totals, chart series, and details derive from the same sample buckets. The
  organization and member views use distinct values. Detail tables retain the
  product's maximum height and shared Fluid ScrollArea, including edge fades.

The demo supplies fictional content through real header slots. The Space member
button opens the product's resizable member panel or mobile drawer. The panel
starts open on desktop at a demo-specific minimum width of 12rem. Live and You
labels are hidden in demo member rows. Thread starts at 24rem with a 20rem resize
minimum. The product's default resize limits and labels remain unchanged. The
Space sidebar starts at the product's 200px minimum. Product and demo share
expanded/hidden dragging and keyboard resizing, with no icon-only intermediate
tier. Titles remain single-line with an ellipsis when needed; Center Agent fits
at the minimum. Its search input is omitted through `ConversationsSidebar.showSearch`.
Team uses the same minimum. Product and demo reuse the same 16px trailing
header inset and fixed 56px `SpaceInlineSidePanelHeader` for Members and Thread,
including the loading state. The demo adds no separate alignment override.
The 28px user avatar
shares the rail's centerline with the organization switcher and navigation.
Claude Code and Codex messages show their human owner.
The first Space follows a checkout regression: James reports the failure, Maya
sets the review requirements, and Center Agent delegates to Codex and Claude Code
before reporting to both people. Billing review and patch review have compact
reply previews and an Open thread action. Billing review starts open on desktop;
other threads and phone threads start closed. Threads open between the main
conversation and Members, and reuse the same message rows and Composer. The main
conversation uses the remaining width; Thread has a readable initial width and
Members stays compact.
Thread and Members widths remain draggable through the product's sidebar rail.
A thread reply stays in its thread and updates its main-timeline preview. Closing
and reopening a thread retains replies for the current demo session.
A pinned Center Agent private chat links to
Release handoff, a three-agent Space with no human composer. A prefilled Wake draft lets
visitors send the next step with one click.

The prefilled Composer has one subdued, eight-second BorderBeam lap, composed
through `@openmeld/ui` from the installed Libraries.dev primitive. The cue pauses
offscreen or while hidden and stops on focus, after one lap, or when the draft
clears. Reduced motion keeps a static edge. Empty reply Composers do not glow;
ordinary product Composers are unchanged.

Optimistic messages and replies use the same transcript layout. Each requested
Agent starts with Working inside its
reply bubble; streamed text fills that same bubble without a separate status row.
The message column uses the available width. Sidebar
pinning changes memory-only state. Team uses the shared header and the real
People overview. All six Team tabs use the memory router and remain interactive.
People and Agent cards open the real read-only detail components. Plugins use the
bundled product catalog, with local empty connection records. Search and category
filters work; provider authorization and credential inputs are omitted. Files
reuse the product browser and its toolbar slots for Team files, My files, and
Trash. Skills open the real catalog and read-only detail page.

Inbox supports category/filter changes, unread-only, item menus, bulk mark-read,
and links back to sample Spaces. Its blue rail dot derives from the same local
items. Workspace-wide message search is omitted because it requires live data.
The organization menu contains the fictional Amplift organization; the user menu
shows Maya's identity. Account-changing, chat-creation, and creation controls are
omitted. Existing product consumers retain their default capabilities.
The shared `AppLinkCapability` disables public-link actions in demo menus.
Internal memory-router navigation remains available.

## Data boundary

Memory adapters replace server functions, Inbox/catalog/Routine/usage API calls, organization
context, sidebar preferences, cookies, and browser preferences.
The demo's Bot palette starts at Original, matching the hero description. Avatar
previews, messages, member panels, and sidebars use the same shared color owner.
A memory router keeps product links inside the demo. The composer reuses the product mention
picker and Wake/Reference tokens. Relation labels and controls are hidden only in
the demo to keep the presentation simple; addressing behavior is unchanged.
Sending adds an optimistic message, then locally
simulates Thinking, Working, and a short template reply for each addressed Agent.
One in-memory request drives the transcript, thread previews, and sidebar state.
Thread placement is retained in that request, so simulated Agent replies return
to the same thread. Human mentions and
Reference tokens do not start replies. The attachment button is disabled.
Reloading clears conversation edits. The Center Agent avatar choice lasts for
the browser tab and updates messages, member panels, and sidebar previews together.

The artifact CSP has `connect-src 'none'` and `form-action 'none'`. It has no
credentials or live execution transport. The iframe permits scripts and same
origin; this is trusted authored code, not a security boundary for untrusted
content. Do not add account/session providers or product storage reads. The only
storage is the dedicated demo avatar key described above. Recheck imports
and inspect browser network/console output after updating product components.

The hero loads eagerly. Create Agent, Center Agent, and Usage use lazy iframes whose own content
ResizeObserver reports a bounded height to the same-origin parent. Its content
has no viewport-height scroll wrapper. Each scene
starts on a dark HTML canvas before scripts or styles load. Create Agent, Center Agent, and
Usage use transparent document backgrounds once mounted, allowing the landing
page shader to show around their cards. The shell reserves
12px top, right, and bottom insets on desktop, with no bottom toolbar.
The real editor
and component bundle is larger than a screenshot. Do not claim production
performance from a localhost smoke; measure the deployed asset delivery before
promoting this draft.

## Layered product DOM

Lower knowledge and Routine sections render real product components as DOM,
with no screenshot assets or imitation controls. The frozen bundle provides:

- `ShowcaseFiles`: the real FileSystem list and Team files toolbar.
- `ShowcaseSkill`: the real `OrganizationSkillDocument`.
- `ShowcaseRoutines`: three fictional team routines in the real Routines page.
- `ShowcaseRoutineResult`: real Space header, message, and file card.

Showcase roots are inert and expose their natural content height through the
same bounded message used by Create Agent. The parent fits and scales the DOM
viewport, so all rendered text remains text and no inner scrollbar is needed.
On small screens, the foreground Skill and report remain readable; secondary
table layers are available in the feature drawers. Rebuild the frozen demo when
these components or fixtures change. Website builds do not rebuild the Web App.
