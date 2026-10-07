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
- Team: `FileSystem`, `OrganizationSkillDocument`, and `RoutinesPage`.
- Interaction primitives: existing `@openmeld/ui` Fluid and Base UI components.

The demo supplies the title/tab composition and fictional content. Unsupported
Team tabs are disabled. Account-changing and creation controls are omitted.
The product's organization initial is used for the fictional team's rail icon.

## Data boundary

Memory adapters replace server functions, Routine API calls, organization
context, sidebar preferences, cookies, and browser preferences. A memory router
keeps product links inside the demo. The local composer appends a visitor's text
without simulating an agent response. Reloading clears all edits.

The artifact CSP has `connect-src 'none'` and `form-action 'none'`. It has no
credentials or live execution transport. The iframe permits scripts and same
origin; this is trusted authored code, not a security boundary for untrusted
content. Do not add account/session providers or storage reads. Recheck imports
and inspect browser network/console output after updating product components.

The hero loads eagerly; lower scenes use native lazy iframes. The real editor
and component bundle is larger than a screenshot. Do not claim production
performance from a localhost smoke; measure the deployed asset delivery before
promoting this draft.
