# Independent website and App origin

Status: implementation in progress. No production routing has changed.
Remove after the migration ships and its acceptance is recorded in the owner docs.
Base: `42c456e34fedb9376bd1fe6a2bacc4905e75b9ea`.
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
| `/setup`, `/cli/*`, `/desktop/*`, `/skills/*`, `/guide.md`, `/SKILL.md`, `/agent-interface/guide.md` | Stable public distribution URLs; existing Web handlers remain the single implementation owner |
| `/desktop` | Public download entry backed by the existing promoted-release reader; distinct from private App state |
| Website assets, fonts, brand images, robots and sitemap | Website build; asset namespace must not collide with old App bundles |
| Existing App static assets | App build; account for already-open tabs during cutover |
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

Provider dashboard values, successful consent, and existing Passkey reuse remain
unverified until evidence is recorded. Code inspection alone is not end-to-end
authentication evidence.

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
settings, consent and registered Passkey reuse remain unverified.

CLI emits App Space URLs and accepts both new App and legacy website inputs.
Old CLI can continue using Space IDs and old root URLs; pasting a new App URL
requires the updated CLI. No Wake, setup, Service lifecycle, dispatch-owned Space
action, status, trace, rescue, or managed Skill payload changes. New cloud still
accepts old local transport, and new CLI still accepts old cloud responses.
This is an additive URL capability; local components use advisory `available`
policy rather than raising execution contract epochs. A bundled Service hash
change from shared packaging does not by itself establish a wire incompatibility.
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
