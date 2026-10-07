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

The website owns `/`, `/privacy`, `/terms`, `/changelog`, and
`/guides/local-agents/*`. Changelog data still comes from the anonymous Gateway
reader. Brand components, fonts, and assets belong to `@openmeld/ui`; static
agent metadata and public metadata helpers belong to `@openmeld/product-catalog`.
Public content is not duplicated in Web.

### Frozen product demo

`/product-demo/` is a static, explicitly refreshed presentation artifact. Its
builder lives in `clients/web/scripts/website-capture` and composes real Web
components with fictional data and memory-only adapters. Website runtime code
does not import Web-private modules or call App APIs. Website builds publish
the checked-in artifact; they do not rebuild it when product code changes.

The embedded demo supports a bounded set of interactions: Space navigation,
local message composition, Inbox read/filter actions, all six Team tabs,
read-only People/Agent/Plugin details, file browsing, Skill inspection, and sample Routine
editing, pause/resume, and history. It does not authenticate, execute agents,
connect providers, or persist changes. Transport and preference adapters are
replaced during compilation. A CSP blocks network connections and form
submission. The iframe permits same-origin scripts so normal module loading
works; it is trusted authored presentation, not an origin isolation boundary.
Keep this boundary and the explicit refresh instructions in the builder README.

Navigation uses ordinary anchors. App links enter the existing App resolver,
which alone chooses the viewer's Organization and checks access. Web's public
page stubs redirect to the website. `/agent-interface` remains an interactive
App authorization surface; `/desktop` remains Web's promoted-artifact download
entry.

## Retained root-domain protocols

`src/lib/app-routing.ts` owns the explicit root-domain routing policy. Known App
pages accept GET/HEAD and return `307` with `Cache-Control: no-store`, preserving
path and query. Browser fragment inheritance is left intact. Unknown pages
remain website 404s; they are not an arbitrary proxy.

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
when fetching it. Preserve the JSON bytes, stable Connector callback, and shared
`/icon-512.png` logo. This is one public metadata owner, not a wildcard proxy for
all well-known paths. Migration and rollback health verify its direct JSON response.

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
