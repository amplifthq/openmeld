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

The site organizes public guides by product area: Get started, Spaces, Center Agent,
Remote Agents, Local Agents, Agent Harness, Team, Settings & Administration, Security & Privacy,
Concepts & Reference, and Help. Metadata references keep existing article URLs
stable while moving their navigation placement. Shared Skills, Files, and
Routines guides each have one owner; Agent-specific guides link to them and
explain execution differences. Production builds allow indexing and expose a sitemap
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

## Local Agent setup guides

`content/docs/start/local-agents` owns the setup overview and seven Agent guides.
Keep installation prose here, not in the shared product catalog or Website.
Provider-specific installation commands and platform requirements link to official
guides. OpenMeld connection, detection, and recovery guidance stays in Docs.
Each guide declares `icon: local-agent:<id>`; the source loader renders the
existing `@openmeld/ui` LocalAgentLogo. These pages participate in the same
search, Markdown, and LLM projections as all other public guides.

## Content and rendering

`start/connect-with-agent` owns the public, copyable setup handoff. It links to
the App's Agent Interface for fresh private authorization. Keep tokens and
authenticated prompt generation in the App; never embed them in Docs, Markdown,
or LLM projections. The public prompt scopes recovery to connecting the computer
and distinguishes service health from a successful Agent task.

`content/docs` is the MDX source. `src/lib/content.ts` declares the official
Fumadocs macro. `src/lib/source.ts` owns its server-side source loader and LLM
projection. Keep those imports separate so browser content does not import the
server's page-tree and icon registry.

The framework owns routing. `/docs/*` renders MDX. `/api/search` uses
Fumadocs' built-in search. `/docs/*.md`, `/llms.txt`, and `/llms-full.txt`
expose only the same public content. Markdown negotiation varies by `Accept`.
Page titles, descriptions, and canonical URLs come from each page. Public
pages may link to the public source repository. Keep private maintainer
configuration out of public instructions. The public self-hosting page explains
that published source and a connected computer do not constitute a supported
standalone installation.
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

## Content maintenance

Keep the page tree in `content/docs/**/meta.json` as the navigation owner.
Relative page references can place a guide in another group without changing
its URL. `llms(source)` consumes this same tree for `/llms.txt`; do not maintain
a separate LLM navigation list. `/llms-full.txt` includes all public pages.

Before handing off a content change:

- Verify product claims against the current source, not only an older guide.
  For Routine form fields use `clients/web/src/components/routines/routine-form.tsx`;
  for Run labels use `routine-run-presentation.tsx` in that directory and the
  status contract in `packages/schemas/src/schemas/http/center-agent-routines.ts`.
  For skipped Run behavior read `services/core/src/routines/routine-scheduler.ts`
  and `routine-local-delivery.ts`.
- For Space addressing, check `space-composer-editor.tsx`; for task file access,
  check `space-message-task-context.tsx`, both under
  `clients/web/src/components/spaces`. Project and Agent changes also require
  their scoped product owners and implementation. Do not present source review
  as evidence that a production workflow was exercised.
- Keep old page URLs and heading anchors. If a move is necessary, provide and
  verify the redirect or anchor alias in HTML and Markdown routes.
- Preserve the zero-install Quickstart. Put prompts in copyable `text` blocks
  and include a result check. Do not add setup as a prerequisite to that example.
- Run `pnpm --filter openmeld-docs check:content` for page-tree coverage, local
  page links, and the Run status fact-sync check. This is a bounded check, not a
  claim that every product statement is verified.
- Run the Docs build, lint, and typecheck. With a local Docs server, run
  `pnpm --filter openmeld-docs check:content -- --url http://127.0.0.1:3600`
  to check rendered heading anchors, all public page Markdown responses, and
  missing-page 404s for HTML, `.md`, and Markdown negotiation.
- In the complete UI, check search, sidebar navigation, Copy Markdown,
  Open → Markdown, keyboard dismissal, and the 390px layout. Check the old URLs
  and common anchors against the change's base. Record what actually ran.

Content-only IA work does not alter Agent execution, availability, routing,
or service lifecycle contracts. A guide must describe those owners rather than
introduce a second interpretation of their state.

## Agent Harness content ownership

`content/docs/agent-harness` explains execution mechanisms after the Agent product
guides. Keep Spaces plural to match product navigation. Link to existing task,
permission, and usage workflows instead of duplicating them.

Verify collaboration against `packages/space-mesh/src/collaboration-context.ts`,
`services/remote-agent/agent-core/prompt/task-coordination.ts`, and Core's
`center-agent-delegation-service.ts` and `personal-remote-agent-space-tools.ts`.
The Space Board is an Agent-readable projection, not another task writer.

Verify hosted context and cost claims against `services/remote-agent/flue-adapter`
(`model.ts`, `model-context-policy.ts`, `conversation-compaction.ts`, and
`retained-tool-results.ts`) and `agent-core/tool-result-boundary.ts`. Verify loop
claims against `agent-core/tool-progress.ts`, its tool classifications, Core
handoff admission, and `developing/architecture/agent-transport-contract.md`.
Do not generalize a hosted tool limit to Local tools, the member-owned Remote
handoff limit to all transport, or prompt guidance to an enforced guarantee.
Do not publish planned loop fuses, universal spending caps, guaranteed cache
savings, or lossless summaries as shipped behavior. Keep numeric tuning values
in their implementation owners unless users need them to make a decision.
