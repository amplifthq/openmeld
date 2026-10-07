# Frozen Website demo

Build-time reuse keeps the Website honest without tying its release to every
App UI change. The source composes actual Web and shared UI components. The
Website publishes the resulting static artifact, not a second product app.

## Provenance and refresh

This revision starts from product UI at `c0732ec03` on origin/main. All sample
people, messages, files, Skills, and Routine results belong to fictional Atlas.
No production account, captured conversation, or private asset is included.

From the repository root:

```sh
pnpm -C clients/web exec vite build --config scripts/website-capture/vite.config.ts
pnpm -C clients/website dev
```

Review `/product-demo/index.html?scene=Conversation`, `Spaces`, `Files`,
`Skills`, and `Routines`, plus the embedded homepage at desktop and phone
widths. Commit the builder and regenerated `clients/website/public/product-demo`
together. Ordinary Website builds never refresh this artifact. Revert those
files together to restore a prior version.

## Real component owners

- Shell: `AppSurfaceLayout`, `AppRailNavigationGroup`, `ConversationsSidebar`,
  `PeopleSidebar`, and `SpaceWindowHeader`. The harness composes their slots.
- Spaces: `SpaceDirectory`, message primitives, `SpaceAttachmentFileCard`, and
  `SpaceComposer` with the real editor.
- Rail: `OrganizationSwitcher` with the shared pointer-reactive O avatar,
  `SidebarUserFooter`, and `DitherProfileAvatar`.
- Inbox: `InboxPage`, its feed, filters, item menus, and read-state mutations.
- Team: `TeamHeader`, `TeamHome`, `DirectoryHumanProfileDetails`, `AgentList`,
  `AgentProfileSidebarItem`, `AgentProfileWorkspaceDetail`,
  `OrganizationPluginsPage`, `OrganizationSkillsListPage`,
  `OrganizationSkillDetailPage`, `FileSystem`, and `RoutinesPage`.
- Interaction primitives: existing `@openmeld/ui` Fluid and Base UI components.

The demo supplies fictional content through real header slots. The Space member
button opens the product's resizable member panel or mobile drawer. Sidebar
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
The organization menu contains the fictional Atlas organization; the user menu
shows Maya's identity. Account-changing, chat-creation, and creation controls are
omitted. Existing product consumers retain their default capabilities.

## Data boundary

Memory adapters replace server functions, Inbox/catalog/Routine API calls, organization
context, sidebar preferences, cookies, and browser preferences. A memory router
keeps product links inside the demo. The local composer appends a visitor's text
without simulating an agent response. Reloading clears all edits.

The artifact CSP has `connect-src 'none'` and `form-action 'none'`. It has no
credentials or live execution transport. The iframe permits scripts and same
origin; this is trusted authored code, not a security boundary for untrusted
content. Do not add account/session providers or storage reads. Recheck imports
and inspect browser network/console output after updating product components.

The hero loads eagerly; lower scenes use native lazy iframes. Each scene
starts on a dark HTML canvas before scripts or styles load. The shell reserves
only its normal 8px bottom inset, with no bottom toolbar.
The real editor
and component bundle is larger than a screenshot. Do not claim production
performance from a localhost smoke; measure the deployed asset delivery before
promoting this draft.
