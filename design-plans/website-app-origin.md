# Independent website and App origin

Status: implementation in progress. No production routing has changed.
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

The final production sequence is reviewed before execution: prepare the App
hostname and receiving service configuration; publish compatible internal
clients; verify authentication and distribution; process internal drafts; then
switch the root website routing. Record exact prior deployments/routes for
rollback. Do not change production from this implementation worktree.

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
