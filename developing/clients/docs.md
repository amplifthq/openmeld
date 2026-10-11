# Public Documentation

## Agent Context

- Purpose: Own the independent public documentation client.
- Read this when: Changing the documentation app, content source, UI, or public routes.
- Update this when: Framework, content, route, presentation, or runtime ownership changes.
- Do not use this for: Internal engineering docs, App authorization, or release permission.
- Source of truth: `clients/docs` owns the public docs. Release sequencing belongs to `../engineering/production-release.md`.

## Boundary

`docs.openmeld.ai` uses its own TanStack Start/Vite build and Cloudflare Worker.
Staging uses `docs.staging.openmeld.ai`. It reads no App session, Organization
state, database, or authenticated API. Parent-domain cookies can reach this host.
The renderer ignores them and must not forward them to another service.

The site contains public product guides organized by user task: Start, Work,
Team, Help, and Reference. Production builds allow indexing and expose a sitemap
generated from the same MDX source. Development and staging remain noindex.
Do not copy `developing/` or internal operational runbooks into public content.

Write instructions in plain English. Give prerequisites, numbered actions,
the expected result, and a recovery link where they help the user finish.
Verify navigation against the current product and its owning source. Explain
availability differences explicitly; a supported source path does not prove
that a downloadable binary or a production UI is already available.

Desktop download links and release labels follow the
[Desktop Download Entry](web.md#desktop-download-entry) contract. Keep macOS and
Windows instructions separate. Refer readers to the canonical download page for
current versions, build availability, and release notices instead of copying
temporary rollout details into the guides.

## Content and rendering

`content/docs` is the MDX source. `src/lib/content.ts` declares the official
Fumadocs macro. `src/lib/source.ts` owns its server-side source loader and LLM
projection. Keep those imports separate so browser content does not import the
server's page-tree and icon registry.

The framework owns routing. `/docs/*` renders MDX. `/api/search` uses
Fumadocs' built-in search. `/docs/*.md`, `/llms.txt`, and `/llms-full.txt`
expose only the same public content. Markdown negotiation varies by `Accept`.
Page titles, descriptions, and canonical URLs come from each page. Public
pages must not link readers to the private source repository.
Build-time crawling prerenders linked HTML pages. Cloudflare removes trailing
slashes consistently with the router. `/docs` and `/docs/*` run through the
Worker first to preserve `Accept` negotiation; the root and static assets can
be served directly. The Worker retains search,
Markdown, server functions, and real 404s. Unknown paths must not return an App
shell. The root Website's existing `/llms.txt` protocol remains Website/App owned.

## Presentation

Use the official Fumadocs Base UI layout, search dialog, navigation, and MDX
components. `@openmeld/ui` owns the wordmark, fonts, and copied public assets.
Fumadocs CSS remains scoped to this client. Do not import the complete App shell
or replace shared tokens globally.

`src/lib/layout.shared.tsx` supplies the same official image wordmark to the
home, article, and mobile layouts. The logo links to the configured Website
origin; the separate Docs link returns to `/`. Use the light/dark wordmark
exports from `packages/ui/public/brand` and the shared favicon URLs.

The Open App navigation item uses Fumadocs' custom-link slot to compose the
compact shared `OpenAppButton` with its static Web badge. It retains the same
public App destination and does not introduce Website shader dependencies.

For new product primitives, inspect the shared Fluid component first. Add
eligible standalone components through the MDX component map. Keep Fumadocs
compound slots inside their own Base UI roots. Its dependency version differs
from the App's Base UI, so mixing roots and items requires a verified context
contract. Preserve roles, focus, keyboard navigation, and reduced motion.

## Validation

The Docs CI workflow checks types and admits the production renderer through
local Workerd. The guarded artifact checker binds HTML source/build metadata
to the exact clean artifact, saves its immutable snapshot, and closes its preview.
Browser smoke must also exercise navigation, search, Markdown, missing pages,
theme selection, mobile layout, and keyboard dismissal.
