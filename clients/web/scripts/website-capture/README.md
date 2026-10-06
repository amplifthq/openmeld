# Website product captures

Run from the repository root:

```sh
pnpm -C clients/web exec vite --config scripts/website-capture/vite.config.ts
```

Open `http://127.0.0.1:30185/o/test/spaces/release` in a browser. Capture at
1280 × 760 and 390 × 1040 CSS pixels, with device scale 2. Export JPEG at
quality 94 to `clients/website/src/assets/product/shared-space.jpg` and
`shared-space-mobile.jpg`. Inspect both images before updating them.

This preview imports production Web components for the shell, navigation,
sidebar, conversation header, message surfaces, profile avatars, Markdown, and
composer. It composes these surfaces with fictional conversation data. It is
not a recording of a live agent execution or a signed-in user session.

The preview reuses the existing conversation-preview transport isolation.
Server functions throw instead of calling a Worker. The composer does not send
messages. No production account, credentials, private files, or user history
are loaded. The sidebar data comes from the existing in-memory test fixture.
The capture override selects Release planning to match the transcript.

Website consumes static image assets only. Do not import Web components into
Website or add an authenticated App dependency to the public landing page.

Refresh these captures when the production UI changes. The public caption must
continue to identify the sample workspace.
