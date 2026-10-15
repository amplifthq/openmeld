# Public Website

## Agent Context

- Purpose: Define the independently published public website and its App boundary.
- Read this when: Changing public pages, assets, website-to-App links, or retained root protocols.
- Update this when: Public route ownership, shared presentation, or origin routing changes.
- Do not use this for: App authorization, Space state, provider consent, or release permission.
- Source of truth: `clients/website` owns public presentation; `clients/web` owns App behavior. Release sequencing belongs to `../engineering/production-release.md`.

## Ownership

`openmeld.ai` is the public website. `app.openmeld.ai` is the Web App. Staging
uses `staging.openmeld.ai` and `app.staging.openmeld.ai` respectively. The website
has its own TanStack Start/Vite build and Worker. It imports no Web-private
modules and reads no session, Organization selection, or App query cache.
Its homepage remains public even when the visitor has an App session.

The website owns `/`, `/privacy`, `/terms`, `/changelog`, and `/downloads`.
Legacy `/guides/local-agents` and its supported Agent detail URLs return
permanent redirects to `/docs/start/local-agents` on the Docs origin. Unknown
Agent IDs remain 404s. Docs owns the guide content; Website has no guide renderer.
`VITE_DOCS_URL` selects the local override; staging and production builds use
their matching public Docs origins. Deploy Docs before activating these redirects. Changelog data still comes from the anonymous Gateway
reader. Brand components, fonts, and assets belong to `@openmeld/ui`; static
agent metadata and public metadata helpers belong to `@openmeld/product-catalog`.
Public content is not duplicated in Web.

The website publishes `/sitemap.xml` for its canonical public pages.
`robots.txt` allows the rendered CSS and JavaScript under `/_website/assets/`
while excluding other internal Website paths. FAQ answers remain in the
initial HTML through the shared Accordion panel's `keepMounted` prop.
The installed-PWA migration notice follows product content and uses
`data-nosnippet`; its standalone display behavior remains unchanged.
Nonproduction Worker responses carry `X-Robots-Tag: noindex, nofollow`.
App forwarding keeps its existing response contract.
See [search discovery](../engineering/search-discovery.md) for launch checks,
question coverage, and measurement boundaries.

### Frozen product demo

`/product-demo/` is a static, explicitly refreshed presentation artifact. Its
builder lives in `clients/web/scripts/website-capture` and composes real Web
components with fictional data and memory-only adapters. Website runtime code
does not import Web-private modules. Website builds publish
the checked-in artifact; they do not rebuild it when product code changes.

The embedded demo supports a bounded set of interactions: Space navigation,
local message composition and thread replies with the product mention picker and
simulated Wake progress/template replies, Inbox read/filter actions, all six Team tabs,
read-only People/Agent/Plugin details, file browsing, Skill inspection, and sample Routine
editing, pause/resume, and history. It does not authenticate, execute agents,
connect providers, or persist changes. Transport and preference adapters are
replaced during compilation. Billing review starts open on desktop; patch review
and phone threads start closed. Their compact previews open the real resizable
panel shell, header, message primitives, and Composer.
Main conversation and Thread viewports reuse `@openmeld/ui/fluid/scroll-area`,
the same scroll presentation owner composed by the product MessageScroller.
Its measured 12px edge fades soften hidden messages below the header and above
the Composer; visible content at the start or end stays clear. Demo transcript
padding belongs to the content slot, and local follow behavior targets the
shared viewport.
The Members panel stays open on desktop and uses a smaller demo-specific resize
limit. Its Live and You labels are hidden to reserve more reading space for
Thread, which has wider default and minimum widths.
The Space sidebar starts at the product's 200px minimum and keeps titles on one
line with an ellipsis, including when hover actions appear; its search input is
omitted. The demo organization trigger starts 16px below the canvas top and
keeps its 36px hit area while its O logo uses a smaller 5px glyph size.
Product and demo Members and Thread headers reuse
`SpaceInlineSidePanelHeader` at a fixed 56px height, including loading states.
The demo Composer draws a soft colored BorderBeam around a sendable draft in a
slow ten-second loop. It pauses while hidden or outside the viewport and fades out
while the Composer has focus, is sending, or has no draft. A remaining draft
regains the cue when focus leaves; entering Product later does not lose it to
a timer. Reduced motion uses a static edge. This cue belongs to the frozen demo
and does not change product Composers.
`SpaceWindowHeader` uses the same 16px trailing inset, so its last action aligns
with the panel's close button without a demo-specific override.
The public Product anchor centers the complete demo frame in the viewport using
the same responsive height that sizes its iframe.
Wake/Reference labels are hidden in demo tokens, without changing the retained
addressing or simulated reply placement. Thread replies and previews
derive from the same in-memory request state. A CSP blocks network connections
and form submission. The iframe permits same-origin scripts so normal module
loading works; it is trusted authored presentation, not an origin isolation boundary.
Keep this boundary and the explicit refresh instructions in the builder README.

The focused Create Agent scene reuses personal Remote Agent configuration,
including provider/model selection, reasoning controls, and the selected
provider's avatar. Its model choices come from the bundled release catalog;
the runtime header shows five supported provider examples alongside Local Agent
logos. The demo initially selects Claude Opus 5.5 for Remote Agents. These
selections remain local presentation state.

The Center Agent section follows Create Agent and precedes Channels.
It presents the organization's agent with the product avatar editor and hosted
model selector, initially GPT-6 Astra, on a transparent canvas without status
badges or outer dividers. The Usage section follows Cloud Computer and composes the real cloud
cost and Local Agent token cards in a layered layout. Organization/member scope,
Details, and period controls operate on schema-validated fictional records.
Expanded tables retain the product's bounded Fluid ScrollArea. Refresh controls
are hidden in this fictional demo. Both scenes reveal the page shader around
their individual cards. These
presentation adaptations do not change the App's settings, usage authorization,
or default model. Channels precede Team Knowledge and Routines.

The Plugins section uses available entries from the public Plugins catalog
and shared app logos. The logo wall groups connections by brand and divides
distinct logos evenly between its two rows; its details Sheet lists every
supported connection. Its footer rounds the available Plugin count down to
the nearest ten and adds `+`: 63 becomes `60+`, and 74 becomes `70+`. The details
list remains the precise current catalog. Wrapped brand names stay centered within
their tiles. Channel support does not admit a Plugin.
The CSS marquee pauses offscreen or while the page is hidden and has an explicit
pause control. Reduced motion shows all brands in a static grid.

The hero uses the full app shell and loads immediately. Other frozen scenes
start loading within 300px of the viewport, once per mount, so their App
initialization does not compete with the hero entrance. Focused surfaces report their content
height to the same-origin parent, so they do not need a nested scroll region.
The parent admits only each iframe's source, origin, and bounded numeric height.
Later Files/Skills and Routine sections layer actual product DOM with fictional
data, rendered by the frozen demo in its own CSS boundary. These showcase roots
are inert; they are not screenshots. Shared Sheets expose additional context.
The builder and frozen artifact are refreshed together when these views change. Demo
links stay in memory; the app-link capability hides Copy link actions because
fictional objects have no public URL. Normal app surfaces retain that capability.
The Web badge uses a lazy Metal effect with a static reduced-motion fallback.
Hero pointer motion is limited to fine pointers and disabled for reduced motion.
The hero starts its CSS timeline after hydration, so module loading does not
consume the visible entrance. It reveals title lines and supporting copy with
Linear's one-second blur and translation timing. The live App uses a later opacity reveal and a temporary
edge veil that disappears completely; it has no persistent blend mask or blur.
Hero avatars opt into the shared renderer's `ambient` mode: vendor idle movement,
nearby pointer tracking, and full click jumps. An SVG poster in server HTML
prevents empty avatars while the canvas starts. The vendor shares one ticker
and pauses offscreen or while the document is hidden. Reduced motion keeps
avatars still and uses a short entrance fade only.
Focus on hero actions completes their existing browser animation. Focus changes
never remove or restore its CSS declaration, so menus and keyboard navigation
cannot replay the entrance. The same rule applies to the open-source link group.
Other demos use static CSS alpha masks with broad directional fades, measured
against Linear's feature stages. Files and Skills retain their upper-left edges
while fading roughly half of their bottom and right areas. Routines fade both
sides of the background table; the foreground result keeps its top-left frame.
Agent and Center Agent scenes keep their primary heading and choice clear while
their lower/opposite corners recede. Usage protects its upper-left heading.
Codex feathers its full frame over broad side and bottom areas while retaining
its central conversation; playback controls sit outside the masked surface.
Its composer keeps the project name, add icon, and send arrow; it omits inactive
sidebar controls and extra device or model labels. Masks never
depend on focus, filtering, playback, or iframe state, and keep the same profile
after navigation and refresh. There are no per-demo WebGL lighting loops or
foreground overlays.

Cloud Computer uses Hairline's official Turntable figure, with Riffle illustrating
files and finished work and a smaller Terminal figure above the video conversion
example. The terminal and finished-work cards share grid rows so their figures
stay vertically aligned even when the descriptions wrap differently.
Its four cards share an icon-and-title heading with the same foreground
color and type size. Privacy and Open Source use its Lockers
and Branches figures. `LandingFigure` loads the installed React
components within 300px of the viewport and reserves their 5:4 footprint before
loading. Consumers set only the dark palette, accessible description and
interaction intensity. The package owns geometry, pointer response, reduced
motion, idle scheduling and offscreen pausing. The figures have no autoplay or
additional blur or lighting loop. Keep the solid plate fill matched to the card
background so the official occlusion remains correct. Computer specifications
and terminal output remain outside the illustration.

The privacy and open-source section follows Usage, before the FAQ and final
app-entry section. It summarizes the customer production diagnostics policy:
routine model logs omit conversation content and model inputs/outputs, and
automatic agent reports omit generated summaries and work details. Operational
metadata and authorized workspace history remain available. This presentation
does not claim end-to-end encryption or that infrastructure operators cannot
read stored data. Its source, issue, and pull-request links reuse the homepage's
repository destination. The open-source copy is prepared for public launch;
the repository must be public before publishing that claim.

The capability comparison follows Privacy and Open Source, before the FAQ.
It presents a static, source-reviewed matrix for six alternatives with concise
scope labels and explicit unknowns. Its row definitions and first-party evidence
live beside the component in `comparison-sources.md`, not in public disclosures.
Its catalog row and the Plugins showcase share the same public catalog count;
that count does not establish account-specific connection readiness. The table
composes the shared Table/Fluid ScrollArea and keeps feature names fixed during
horizontal scrolling on narrow screens.

Navigation uses ordinary anchors. App links enter the existing App resolver,
which alone chooses the viewer's Organization and checks access. Website download
menus start downloads directly through the retained `/desktop/download?platform=`
protocol. `/downloads` is the only public download page. It shows verified version
and size metadata in equal-width, equal-height platform cards. Installation
instructions and release notices stay available in each card's collapsed details.
Windows is labeled Preview; macOS is not. Its server reader uses the fixed `APP`
binding to read the anonymous `/desktop/releases.json` projection. Web remains
the only artifact owner and verifies the existing manifests and object sizes.
The shared schema admits only locally derived download paths. Missing or invalid
metadata never creates a download button or selects a different candidate.
Candidate links remain noindex. Website pages share the public header and Fluid
navigation. Legacy `/desktop` links on either domain redirect to the website's
`/downloads`, preserving the raw query. `/agent-interface` remains an interactive
App authorization surface.

This additive metadata contract requires Web to deploy before Website. Existing
CLI, Service, managed Skills, Core, Gateway, setup, Wake, Space actions, and
diagnostic contracts do not change. The existing Desktop download and update
endpoints retain their response contracts and release records. No local-component
contract bump or package release is required. Rollback removes the Website reader
before removing the new Web metadata endpoint.

## Retained root-domain protocols

`src/lib/app-routing.ts` owns the explicit root-domain routing policy. Known App
pages accept GET/HEAD and return `307` with `Cache-Control: no-store`, preserving
path and query. Browser fragment inheritance is left intact. Unknown pages
remain website 404s; they are not an arbitrary proxy.
The retained `/desktop` page alias instead redirects directly to `/downloads`
on the website origin. `/desktop/*` protocols still use the App service binding.

Installers, `/api/auth/*`, `/v1/*`, downloads, managed skills, Slack OAuth start,
`/llms.txt`, and other enumerated protocols use the fixed `APP` service binding to the
matching Web Worker. The original Request and streaming Response retain URL,
method, body, cookies, Origin, Referer, Range, and upstream errors. There is no
caller-selected upstream or second protocol implementation.

Website assets use `/_website/assets/`, its client base is `/_website/build`,
and server functions use `/_website/serverFn`. During cutover,
`LEGACY_BROWSER_COMPATIBILITY=true` also forwards old App `/assets/` and
`/_serverFn/` and `/emoji/` paths. This is a transition window, not a historical bundle store:
save unsent drafts and close/reload old root-origin tabs before replacing the
old Web deployment. Retire the flag only after old browser traffic is gone.
Stable installer, Auth, API, and download paths remain forwarded independently.

The website also owns `/.well-known/posthog-client.json`. PostHog uses that
exact production root URL as its OAuth client ID and does not follow redirects
when fetching it. Preserve the client identity, stable Connector callback, and
other OAuth metadata. The approved branding migration replaces the monochrome
`/icon-512.png` logo with `/brand/openmeld-letter-o-dark-1024.png`. Migration and
rollback health accept only those two reviewed logo URIs and verify the direct
JSON response. This is one public metadata owner, not a wildcard proxy for all
well-known paths.

## Local development

`pnpm --filter openmeld-website dev` serves port 3500. Set `VITE_APP_URL` to the
current worktree Web URL when testing App entry. Public rendering requires no
Auth process. Local config deliberately has no cloud `APP` binding; retained
protocol paths return 503 until tested with an explicit isolated binding.
Local public rendering does not prove end-to-end protocol behavior.

## Browser and native data

The parent cookie domain and Passkey RP ID stay unchanged. Parent cookies mean
the deployables are not separate cookie trust boundaries. Auth admits the exact
App origin and explicit legacy root origin during migration, never arbitrary
siblings. LocalStorage and IndexedDB do not move between origins. Save drafts
before switching; preference/cache reinitialization is expected. Native clients
have a separate installed-artifact acceptance requirement in `desktop.md`.

The existing Web manifests use `start_url: "/"` and `display: "standalone"`.
An old installed root-origin app therefore opens the Website after cutover.
The Website home supplies a standalone-only explanation and an ordinary link
to open the new App in the browser and install it again. Normal browser visits
keep the public homepage. Do not change the manifest ID or use a cross-origin
start URL to imply that installation identity or drafts moved. Save drafts in
still-open old tabs before closing them; reopening the old shortcut is not a
draft recovery path. Test a real old installation separately from visual preview.
