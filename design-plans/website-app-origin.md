# Independent website and App origin

Status: Draft PR #1467; migration-risk audit complete, awaiting independent review and later rollout acceptance. No production routing has changed.
Remove after the migration ships and its acceptance is recorded in the owner docs.
Frozen integrated base: `bec864ee32e5df2528bb5ba9c72dd06042d09309`.
Audit starting candidate: `2fedefc5142384abba7fd27cb2c7b15b6ed7b118`.
Implementation owner: `codex/website-app-origin`.
Review owner: the **评估 App 子域名迁移成本** chat.

## Outcome and ownership

`openmeld.ai` becomes an independently built and deployed public website.
`app.openmeld.ai` owns the application, account entry, workspace UI, and its
same-origin business endpoints. Auth and Gateway retain their existing hosts.
No database migration or replacement framework is needed. A future documentation
site is outside this change.

The website stays in this monorepo as `clients/website`, using React, TanStack
Start, Vite, and Cloudflare Workers at the repository's installed versions.
`clients/web` remains the App. Both consume `@openmeld/ui` for brand primitives,
tokens, fonts, and genuinely shared presentation. Website code must not import
Web-private modules, session readers, workspace state, or browser query caches.
Marketing content has one owner, not two synchronized copies.

The website entry does not discover an Organization. Its App links enter the
App's existing authenticated entry resolver. That resolver remains responsible
for account readiness, selected Organization, and authorization.

## Route inventory

| Surface | Owner and target behavior |
| --- | --- |
| `/`, `/privacy`, `/terms` | Website presentation and canonical SEO |
| `/changelog` | Website presentation; existing anonymous Gateway/Core reader remains authoritative |
| `/guides/local-agents` and agent detail | Public documentation presentation; shared agent metadata is reused where Web also consumes it |
| `/agent-interface` | App: this is an interactive computer authorization/Prepare entry, not static documentation |
| `/o/*`, `/spaces/*`, `/file-preview`, invitations and join links | App; old page links preserve path/query when redirected |
| `/login`, `/sign-up`, email verification, magic link, reset, logout, `/callback` | App/Auth; audit callback state and return destination separately |
| `/device`, `/device/approve`, `/desktop-sign-in`, `/desktop-shell` | App/native authorization contracts; no blanket redirect of machine requests |
| `/add-to-slack`, `/slack/oauth/*`, `/slack/identity/start`, channel linking | App acquisition and identity flow; provider callback remains with its current owner |
| `/api/auth/*`, `/v1/*`, server functions, uploads and streams | Web protocol owners; never treated as ordinary page redirects |
| `/setup`, `/cli/*`, `/desktop/*`, `/skills/*`, `/guide.md`, `/llms.txt`, `/SKILL.md`, `/agent-interface/guide.md` | Stable public distribution URLs; existing Web handlers remain the single implementation owner |
| `/desktop` | Public download entry backed by the existing promoted-release reader; distinct from private App state |
| Website assets, fonts, brand images and robots | Website build; separate asset namespace; no existing sitemap implementation was found |
| `/.well-known/posthog-client.json` | Website owns the unchanged public OAuth client metadata; direct JSON response, never an App redirect |
| Existing App static assets and `/emoji/*` | App build; bounded compatibility forwarding for already-open tabs during cutover |
| `/api/waitlist` | Existing public mutation; inspect usage and retain its owner unless explicitly retired |

The root-domain Worker may use a fixed service binding for retained Web protocol
paths. It must not accept a caller-selected destination. It forwards requests
without converting methods, consuming bodies, buffering streams, or hiding
upstream errors. Public website rendering must not forward browser credentials
to an unrelated upstream or cache personalized output.

Before cutover, an independently deployable website can retain all non-website
traffic on the existing Web owner. This is a deployment transition, not a second
application implementation or a permanent dual-origin authentication system.
Ordinary GET/HEAD page redirects are a separate policy from protocol forwarding.
Fragments are browser-owned; a Location without a fragment preserves them.

## Authentication and integrations

Current installed Better Auth is `1.6.30`. Production explicitly configures
`AUTH_COOKIE_DOMAIN=openmeld.ai` and `PASSKEY_RP_ID=openmeld.ai`; staging uses
its own parent domain and cookie prefix. Preserve those identities during the
App move. Parent-domain cookies mean deployment isolation is not cookie
isolation: website and future sibling hosting remain within that trust scope.
Do not introduce wildcard trusted origins.

| Contract | Current evidence and required check |
| --- | --- |
| Better Auth session, sign-in/out, refresh, CSRF | Web `/api/auth` proxy; exact configured Auth/App origins; validate positive and rejected origins |
| Passkey | Existing parent RP ID; inspect installed expected-origin behavior and exercise an HTTPS browser ceremony before claiming acceptance |
| GitHub account sign-in | Explicit callback at `auth.openmeld.ai/api/auth/callback/github`; provider callback need not move |
| Google account sign-in | Better Auth provider configured conditionally; inspect actual callback and provider allowlist |
| Verification, magic link, reset, organization and Space invitations | Auth generates/validates links; App destination configuration must change coherently |
| CLI device approval | Verification URI derives from `WEB_APP_URL`; CLI account service remains Auth-owned |
| Desktop | Shared production `webOrigin`, native scheme, strict fetch redirects, packaged renderer and updater need coordinated validation |
| Slack | Gateway owns `/slack/oauth/callback`; configured `OPENMELD_SLACK_OAUTH_REDIRECT_URL` and App return path have different roles |
| GitHub App | Gateway/Core own installation and authorization; inspect callback/setup URL and external registration |
| OpenConnector/Plugins | Inventory actual provider catalog, broker callback and return URLs; provider consent is not proved by a simulator |
| Slack/Feishu/Lark publication links | Core generates navigation; changing the App origin must preserve exact task/Organization locators |

The provider registrations inspected on 2026-10-03 are recorded below. Successful
consent and existing Passkey reuse remain separate acceptance gates. Neither
configuration inspection nor code inspection is end-to-end authentication proof.

## Local data and clients

Cloud accounts, Organizations, Spaces and messages stay in their current stores.
Browser localStorage/IndexedDB belong to an origin and do not move automatically.
Internal users must send or save unsent drafts before cutover; preference/cache
reinitialization is acceptable. Do not copy tokens or introduce an unbounded
cross-origin storage bridge. Existing native clients must be updated through
the published lane; an HTTP redirect is not proof that their strict fetch path
works. CLI Space URL parsing must distinguish App hosts from distribution hosts.

## Delivery and validation

The website is a separate guarded release scope. A website-only path change
must select/build/deploy only that scope; shared runtime dependencies still
select their actual consumers. Prove independent publication by comparing the
App artifact/deployment identity before and after a website-only release in an
isolated environment. Add the new Worker to type generation, environment checks,
release evidence, health checks, and affected-workspace selection.

Validation covers public rendering with unavailable auth, website-to-App entry,
authenticated/anonymous workspace routes, query/hash redirects, protocol methods
and streams, cookies/trusted origins, representative invitations, device/native
entry, distribution paths, and release selection. Localhost browser smoke and
isolated HTTPS hostname evidence are reported separately. Provider consent and
native installed-artifact acceptance are separate rows, never inferred from mocks.

The final production sequence is reviewed before execution. Follow the guarded
[Website/App migration](../developing/engineering/production-release.md#websiteapp-origin-migration):
attach App to the existing Web version, expand exact Auth origins, validate that
actual Web/Auth pair at App, handle drafts and old tabs, then publish Website.
Only after root cutover may the App-origin Web/Core/Gateway configuration ship.
Compatible clients have their own acceptance before publication. Do not change
real production or staging routing from this implementation worktree.

## Contract impact and acceptance evidence

Auth adds one exact legacy-origin option; cookies, parent RP ID, native schemes,
Auth host and provider callback owners stay unchanged. Tests cover allowed
current/legacy/native origins, rejected unrelated/sibling origins, explicit
retirement, and a real Hono cookie-write admission boundary. Provider dashboard
settings are recorded below; consent and registered Passkey reuse remain unverified.

CLI emits App Space URLs and accepts both new App and legacy website inputs.
Old CLI can continue using Space IDs and old root URLs; pasting a new App URL
requires the updated CLI. No Wake, setup, Service lifecycle, dispatch-owned Space
action, status, trace, rescue, or managed Skill payload changes. New cloud still
accepts old local transport, and new CLI still accepts old cloud responses.
This is an additive URL capability; local components use advisory `available`
policy rather than raising execution contract epochs. A bundled Service hash
change from shared packaging does not by itself establish a wire incompatibility.
This review candidate leaves the published component versions and manifest
unchanged. Final Candidate uses the documented deferred release-readiness check;
the eventual release must choose and stamp its exact channel version and advisory
policies after the migration source is approved.
New installed Desktop targets App but accepts existing root targets; its strict
Auth/API/installer requests retain nonredirecting forwarding. Native credential
storage is origin-keyed and can require sign-in after upgrading. Native installed
old-to-new acceptance is still required, not inferred from these code checks.

The architecture owner check finds no new readiness, routing, execution or
publication authority: RuntimeCoordinator, Space, Service and Core retain their
existing contracts. Website is presentation plus an explicit fixed service-binding
forwarder. Domain observations do not replace component release receipts.

On 2026-10-03, an isolated local fixture passed normal email login, Space read,
message send, persisted read after reload, and sign-out in the in-app browser.
The Chrome plugin was unavailable. The actual Website production build passed
Workerd SSR for home, privacy, terms and local-agent guides, and was published
only to the disposable `website-migration-1467` trial Worker/domain. Its HTTPS
homepage and FAQ hydrated, canonical App links and the separate asset namespace
were present, GET login returned 307/no-store with its encoded query intact, and
POST forwarding retained the root URL, body and Origin. Browser fragment
navigation was blocked by the browser tool, so it is not claimed as browser proof.
The viewport override also did not change the observed 1560px viewport; mobile
layout is not claimed from that attempt.

The trial App deployment stayed `60e9fea6-c8d3-4f43-b7d6-56a173e197c9`
(version `210101cc-ca71-4741-8ddc-37b0f4d7013b`) across Website publication.
The Website version became `af1d3af6-e854-4f7a-abc2-64f8c7fae558`. The App side
of that HTTPS trial was an echo fixture; actual App business behavior was tested
locally as a separate layer. Prior trial forward/reverse domain transfers using
Wrangler `triggers deploy` preserved both deployment IDs. Plain Domains PUT
returned 409/100116 for takeover, so production recovery uses the public Wrangler
command. These discrete observations do not prove atomic zero-downtime switching.
No real production/staging cutover, native artifact publication, or provider
registration change has been performed by this task.
Both disposable domains and Workers were removed after the trial, with ownership
and deletion read back before cleanup was declared complete.

## Migration-risk audit — 2026-10-03

This audit holds the base and starting candidate above fixed. It does not chase
main, deploy services, switch domains, certify a new Final Candidate, or publish
native artifacts. The earlier Final Candidate and three artifact builds certify
their recorded `2fedefc5` input only; the audit changes require their own later
delivery acceptance. Local evidence is under `dev-tmp/website-app-migration/`;
the coordinator's sanitized live observations are under
`dev-tmp/domain-audit-coordinator/`. These disposable files are supporting
observations, not dependencies of tracked code or tests.

### Eight ownership boundaries

| Area | Inventory, owner and migration behavior | Evidence and remaining acceptance |
| --- | --- | --- |
| 1. Pages, SEO and static assets | All 171 declared Web routes were evaluated against the actual Website router: 6 Website, 108 App page redirects, 57 retained Web protocols. Organization/Space deep links preserve path and query. Unknown pages remain 404; non-GET/HEAD page requests are rejected rather than redirected. Website owns anonymous home/privacy/terms/guides/changelog, robots, shared brand assets and PostHog metadata. `/llms.txt` and legacy emoji data now retain the Web owner. | `audit-route-coverage.json`, routing tests, actual Website production build and local Workerd metadata response. Previous isolated HTTPS trial covers anonymous public rendering and query redirects. No sitemap implementation was found. Browser fragment and mobile viewport acceptance remain open. Google crawler acceptance is separate from HTTP availability. |
| 2. Account entry and authentication | Better Auth, Passkey and Electron packages are 1.6.30. Auth host, parent-domain cookies and parent Passkey RP ID remain stable. Trusted origins are current App, exact configured legacy App, Auth and existing explicit native/development entries. Web proxies `/api/auth/*` to Auth. Email/password, username, social, verification, magic links, reset, multisession/add-account, logout, device and native OTT paths retain their owning contracts. | Trusted-origin/config/email tests and actual Better Auth handler tests cover exact legacy/current origins, preserved add-account intent, password reset and rejected cookie-bearing untrusted origins. Reset token consumption changes the password and rejects replay. The exact reset form path can open while already signed in; its API still validates the token. Real HTTPS existing sessions, Passkey ceremonies, account switching and concurrent old/new tabs remain release acceptance. |
| 3. APIs, uploads and live transport | Browser business calls remain same-origin `/v1/*`; Gateway/Auth hosts remain stable. Website uses a fixed App service binding, preserving method, URL, body, Origin, cookies and upstream errors. Core still authorizes files and mutations. Account invalidations, Space live connections and Prepare streams keep their existing owners. No caller-selected proxy host or new readiness/execution authority exists. | Actual Workerd service-binding harness passes a 1 MiB binary upload, Range/206 download with disposition, streaming SSE before completion, separate Set-Cookie headers, upstream 503 and bidirectional WebSocket/101. Its App is an echo fixture, not business authorization proof. Existing actual local login/Space/message/reload/logout smoke is a distinct layer. HTTPS live reconnect and in-flight requests at cutover remain open. |
| 4. Browser and installed-client state | Cloud account/Organization/Space/message stores do not move. Composer text/mentions/reply/Wake targets use localStorage; file drafts use IndexedDB. Query caches, setup/Prepare pointers, preferences, recent items, scroll positions and session drafts are origin-bound. Account-change broadcasts and notification permission/deduplication are also origin-bound. Protected-Space password cookies are host-only. No service worker registration or Workbox owner was found. Old PWA manifests start at `/`. | Source audit of composer storage, query persistence/auth boundary, notification and protected-Space access owners. Website adds a standalone-display migration entry. Ordinary browser rendering and the migration layout were inspected; layout emulation is not proof of a real installed PWA launch. Users must copy needed drafts from still-open old tabs before closing them, grant notifications at App, reenter protected-Space passwords and install the App shortcut again. No storage/token bridge is introduced. |
| 5. OAuth providers, Plugins and channels | Stable Auth/Gateway/OpenConnector callbacks are separate from App return navigation. The pinned OpenConnector catalog contains 1,330 services: 1,219 support API keys, 62 custom credentials, 71 OAuth2 and 12 no-auth (categories overlap). All 71 OAuth configurations use the stable broker callback; 12 services are configured live, in seven client groups. OpenMeld advertises 14 Plugins, all with OAuth as the primary mode. | Pinned catalog source, deployed broker inventory and exact provider registration table below. OAuth state is server-owned, single-use and expiring; PKCE/refresh remain broker-owned. Web authorization uses a separate provider window and polls the owning connection projection, not cross-origin postMessage/BroadcastChannel. Existing consent, refresh, revoked grants and native external-browser return still require provider-specific runtime acceptance. |
| 6. Stored and generated links | Auth/Core/Gateway `WEB_APP_URL` changes new emails, invitations, device approval and channel navigation to App. Existing root links continue through explicit page routing. Persisted Plugin connection replies are additionally parsed by shared code and consumed by Core: exact production and staging root/App pairs now normalize to the current origin in both directions. Organization, thread, requester and authorization checks remain unchanged. | Shared parser tests reject cross-environment, sibling and lookalike hosts; Core continuation tests exercise both old and new current origins against the same stored reply and existing receipt/actor rules. No stored message is rewritten. Other remaining root literals are stable distribution/public metadata, internal parsing bases or explicit compatibility inputs. Concurrent billing work is absent from this frozen candidate; its checkout/portal/return/webhook URLs need a fresh audit when integrated. |
| 7. CLI, Service, Desktop and distribution | `/setup`, CLI/desktop manifests/downloads, 42 managed Skill files and guide URLs stay on their public distribution addresses. Official staging root and App requests both keep the canary setup contract. CLI accepts root/App Space links; old CLI can use old links or Space IDs. New Desktop targets App and still accepts root targets. Native scheme, Auth/Gateway endpoints and execution transport stay unchanged. | Staging setup regression and isolated shell tests pass; prior exact-head Skill byte comparison and native origin/CLI parsing checks remain recorded. Native credential storage is origin-keyed, so an upgrade can require sign-in. Installed old/new Desktop, deep links, strict HTTP clients and published CLI/Service acceptance remain open. Final-main local component stamping and release readiness remain deferred; no contract epoch is raised by this additive URL capability. |
| 8. Deployment, security and rollback | Website has its own build/deploy scope and asset namespace. Prepare attaches App to the recorded current Web version before root moves. The release admission guard prevents an App-configured Web/Core/Gateway release while Web still owns root. Rollback restores the recorded previous Web version before root ownership transfers. Direct production PostHog metadata validation now runs after cutover and rollback. | Migration guard tests cover metadata HTML, redirects and wrong callbacks. The earlier disposable HTTPS forward/reverse trial preserved component identities and was cleaned up; it does not prove atomic zero downtime. Production currently still uses root App URLs and has no new App custom-domain bindings. Exact old/new HTTPS pair, DNS/domain observation, old tabs, metadata, health and rollback receipts must be validated by the release owner at execution. |

The frozen Web/Website/Auth/Gateway sources have no global CSP, COOP, CORP or
Permissions-Policy configuration to migrate. File-preview HTML retains its own
restrictive policy; Electron retains its separate main-process CSP. This is an
inventory finding, not a security certification. Parent-domain Auth cookies
place Website inside the existing cookie trust scope. Private APIs are not
Website static assets, and credentials are never forwarded to an arbitrary host.

### Confirmed corrections

| Failure demonstrated before the correction | Correction and independent check |
| --- | --- |
| A magic-link request from the trusted legacy origin lost `intent=add-account`; the signed-in entry guard could then select the existing account. | Accept that intent only from the current/exact legacy origin and expected path; actual delivered email keeps intent and safe redirect while dropping unrelated query fields. |
| The existing forgot-password UI reached `RESET_PASSWORD_DISABLED` because Auth had no reset-email handler. A signed-in browser was also redirected away from a valid reset form. These are existing defects exposed by the audit. | Use Better Auth's existing token lifecycle and the shared email sender/template; link to the configured App reset page. Allow only the token-bearing reset page through the signed-in entry guard. Handler checks verify old password failure, new password success and token replay failure. |
| A stored root-origin Plugin connection reply was no longer recognized at App, hiding its action and causing Core continuation rejection. | One shared parser supports exact same-environment root/App pairs, preserving the owning authorization and reply/thread contracts; both migration and rollback directions are covered. |
| Moving staging `WEB_APP_URL` to App made official canary setup return 404. | Recognize only the two exact official staging origins as the same staging distribution lane; existing local, production and lookalike rejections remain. |
| PostHog's OAuth client ID is a root-domain metadata URL that Website did not contain. A redirect is not valid for this contract. | Move the unchanged JSON to Website's public owner, verify the built Workerd response is direct 200 JSON with byte-identical content, and add cutover/rollback health checks. |
| Old installed PWA launch `/` would become the public homepage; old emoji fetches and the guide pointer were omitted from compatibility routing. | Add a compact standalone entry with an external App link and truthful draft guidance; retain `/emoji/*` and `/llms.txt` with their existing Web owner. Real installed-PWA acceptance is still required. |

Better Auth intentionally permits a cookieless reset request without an external
destination. The security check does not invent a contrary contract: destination
validation remains with Better Auth and cookie-bearing requests retain CSRF
origin validation. No framework upgrade or project-specific auth bypass was
needed for these corrections.

Focused closeout checks pass: 30 selected Auth tests, 13 entry-guard tests,
18 persisted-link parser tests, 17 Core continuation tests, 44 setup tests,
40 Website tests and 3 migration-guard tests. Auth, schemas, Web and Website
typechecks, changed-code formatting and the targeted Website production build
also pass. These do not recertify the earlier Final Candidate or native artifacts.

The final local browser check used the current worktree's normal login form and
fictional account, reached its Spaces page, opened a hydrated reset-password form
while still signed in using a deliberately invalid test token, then confirmed
that the reset URL without a token returned to the existing account's Spaces.
Screenshot: `audit-reset-signed-in.png`. No password was changed through the
browser; successful token consumption and replay rejection are the independent
Auth handler tests above. The first development load hit Vite dependency
reoptimization/React reload errors and succeeded after recompilation and reload;
this is local development evidence, not production failure or HTTPS acceptance.

### Current provider registrations

The coordinator inspected these production registrations on 2026-10-03 and
compared public client identifiers with live Worker/broker configuration where
available. No credential was exposed, changed or recorded; no provider setting
was changed. Registration correctness is not successful consent or token refresh.

| Integration | Verified live owner and registration | Migration decision / remaining boundary |
| --- | --- | --- |
| GitHub account sign-in | `https://auth.openmeld.ai/api/auth/callback/github` | Keep stable Auth callback. Existing dashboard wildcard matching is enabled; dev/staging consumers were not audited for tightening it. Runtime origins remain exact. |
| Google account sign-in | Callback `https://auth.openmeld.ai/api/auth/callback/google`; JavaScript origin `https://openmeld.ai`; enabled | Current code uses server-side Better Auth social login, not One Tap/GSI. No current browser-SDK dependency requires adding App as a JavaScript origin. Real sign-in remains an acceptance row. |
| GitHub App / connector | OAuth `https://connectors.openmeld.ai/oauth/callback`; setup `https://gateway.openmeld.ai/github/app/setup`; webhook `https://gateway.openmeld.ai/github/app/webhook`, SSL verification enabled | Stable owners. Existing OAuth wildcard flag remains unchanged. |
| Slack production app | Gateway `/slack/oauth/callback`, `/slack/events`, `/slack/interactive`; Socket Mode disabled | Exact callbacks stay; App return/navigation is generated separately. |
| Gmail, Google Calendar and Google Drive | Shared enabled Google client, JavaScript origin `https://connectors.openmeld.ai`, callback `https://connectors.openmeld.ai/oauth/callback` | Public IDs match all three live broker services. Preserve the stable callback and server-owned state/PKCE. Google verification remains a separate launch gate below. |
| Notion, Figma and Linear | Each registers `https://connectors.openmeld.ai/oauth/callback` | Keep existing exact broker callback; no App callback required. |
| Cloudflare Workers, R2, DNS and Browser Rendering | Shared broker callback above; public/verified client; client-secret-basic; empty browser CORS and post-logout lists | Server broker flow requires no new App CORS origin. R2 also supports custom credentials; Browser Rendering supports API-key fallback. |
| PostHog | Client ID `https://openmeld.ai/.well-known/posthog-client.json`, callback `https://connectors.openmeld.ai/oauth/callback`; existing authorized app confirmed | Root metadata must remain direct JSON, including its root logo. OAuth is primary; API-key fallback is separate. |
| Feishu / Lark channels | Exactly one connected Feishu registration, using long-connection events; matching published/enabled app has no subscribed interactive callbacks and no redirect URIs. No connected Lark registration. | There is no active root HTTP callback to migrate. Supported HTTP routes remain Gateway `/message-channels/{lark,feishu}/:connectionId/{events,callbacks}` with existing signature verification. Persisted connected state does not prove liveness. |
| Feishu / Lark Plugins | Broker catalog OAuth endpoints use each provider's official accounts/API hosts; stable connector callback; neither configured live | Do not conflate advertised Plugin support with configured OAuth credentials or the active Feishu message-channel app. |

The 14 advertised Plugins are GitHub, Gmail, Google Calendar, Google Drive,
Notion, Linear, PostHog, Figma, four Cloudflare services, Lark and Feishu.
Notion and PostHog additionally expose API-key alternatives. The other 59 OAuth
catalog services are unconfigured in the inspected deployment; they are not
silently included in a claim that all providers work.

Google's project is External / In production, but its Verification Center still
shows branding and sensitive/restricted data access as unverified. A previous
branding review reported an unresponsive homepage and insufficient privacy-policy
content. Those are existing review findings, not proof of today's HTTP behavior
or a regression introduced by this migration. Public root home/privacy/terms
remain the correct destinations. Do not claim Google public-launch acceptance
from moving those pages or from an HTTP 200; privacy content needs review against
actual data collection/use before a separate verification submission. No
resubmission or “fixed” declaration was made during this audit.

Current anonymous production GET checks returned 200 HTML for home, privacy and
terms. The broker's effective `calendar.readonly` scope is sensitive and
`gmail.readonly` / `drive.readonly` are restricted; all three are not yet verified
in the inspected Google project. Staging connector separately registers
`https://connectors.staging.openmeld.ai/oauth/callback` with no JavaScript origins.
The enabled development login client retains localhost callbacks on ports 29490
and 8788 and browser origins on 29488 and 3000. These existing registrations need
no change for this candidate.

### Cutover acceptance still required

1. Before root moves, test the exact deployed Web/Auth pair at App over HTTPS:
   existing session, new sign-in/out, add-account, invitation, reset, Passkey,
   device/native handoff, business mutation and live reconnect. Finish or restart
   in-flight social/PKCE flows; do not copy state tokens between origins.
2. Notify internal users to save/send drafts or copy them from still-open old
   tabs. A closed old shortcut cannot recover old-origin drafts after root becomes
   Website. Close/reload old tabs before replacing their Web bundles; compatibility
   forwarding is not an archive of every historical hashed asset/server function.
3. Validate an actual installed PWA launch and reinstallation, App notification
   permission, protected-Space password entry, native credential reauthentication,
   deep links and published CLI/Service/Desktop paths on their supported platforms.
4. Execute provider consent/return and refresh checks for the integrations in the
   release scope. Treat Google's existing verification and GitHub wildcard review
   as separate provider tasks. Re-audit any billing implementation added later.
5. Use the guarded production-release sequence with before/after component and
   domain receipts, direct PostHog metadata checks, anonymous public pages and
   rollback to the recorded prior Web version. No database rewrite is required.

The shared-contract audit adds only URL compatibility in a shared persisted-link
parser. No payload field, execution epoch, lease, identity, permission, final
outcome or publication writer changes. Architecture acceptance remains satisfied:
Core, Space, RuntimeCoordinator and local Service keep their documented authority.

## Worktree and concurrency

Worktree: `/Users/felix/.codex/worktrees/website-app-migration/openmeld`.
The shared human checkout is untouched. Planned changes are website ownership,
the related Web public entry points, shared presentation/URL owners, and the
necessary release/development configuration. Existing PostgreSQL work (PR #1460)
also changes root package/lock and engineering docs; preserve those additions
when integrating. No database changes belong to this migration.

## Official references

- [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
  supports separate Worker origins without a framework change.
- [Cloudflare Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
  matches the complete URL, including query strings: an exact `/` route alone
  would miss campaign URLs. Do not build the migration on that assumption.
- [Cloudflare service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  is the fixed Worker-to-Worker boundary for retained protocol owners.
- [Better Auth cookies](https://better-auth.com/docs/concepts/cookies) documents
  shared-domain cookies and same-origin reverse proxies.
- [Better Auth Passkey](https://better-auth.com/docs/plugins/passkey) permits a
  parent RP ID; expected origin still needs explicit validation.
- [TanStack Start prerendering](https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering)
  supplies static rendering without introducing another framework.
