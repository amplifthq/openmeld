# Desktop Client

## Agent Context

- Purpose: Define the Electron client's shared application presentation, native
  capabilities, authentication, and independent local Service boundary.
- Read this when: Changing Desktop main/preload/renderer, local assets, login,
  cloud access, CLI integration, tray, packaging, or the Desktop pilot.
- Update this when: Desktop platform contracts, build entry, account isolation,
  Service controls, or distribution responsibilities change.
- Do not use this for: Core execution authority, Service lifecycle internals,
  or production release authorization.
- Source of truth: This document owns Desktop client responsibilities. Web owns
  browser routing and shared business presentation; Core and Space own cloud
  facts; the CLI and independent Service own local execution.

## Product boundary

The native frame waits for hydration before adding its titlebar and content
wrapper. Its first client tree must match the prerendered shell, where no native
bridge exists. A document-level hydration replacement clears the shared Web
Appearance bootstrap attributes, including conversation width and self-message
alignment. Preserve that initialization rather than deriving Desktop-specific
preferences or compensating with local CSS.

Organization entry and route scope use the shared Auth-owned
`GET /v1/account/organization-context` projection rather than generated
server-function IDs. The native credential transport remains unchanged; the
renderer receives account display facts, membership summaries, and a default
Organization ID only. Deploy the additive Auth route before releasing these
consumers. Residual session and other server-function reads still require the
existing pilot build compatibility gate.

Desktop and Web share complete business views and application logic. They have
separate build entries and platform adapters. Desktop ships its renderer assets
locally; loading the hosted Web page in an Electron window is not the target.
Extract reusable business views at their existing ownership boundary rather than
copying Space pages into a Desktop-only implementation.

Desktop is a peer client over the same cloud truth. It does not own a second
account identity, Computer, Agent Profile, Binding, Wakeability projection,
dispatch queue, synchronization engine, or execution state machine.
RuntimeCoordinator remains the workstation execution authority, the Space
durable outbox remains the conveyor, and the Service retains disk/ack recovery.

Closing a window hides it. Quitting Desktop ends only the GUI. Neither action
stops the independent OS-managed OpenMeld Service or accepted work. Explicit
Service actions use the existing CLI contracts and remain separate from GUI
launch-at-login preferences.

Window chrome, traffic-light insets, drag regions, tray, and native capabilities
belong outside the shared content shell. Reuse `packages/ui` for primitives;
do not move business rules into that package.

## Local pilot foundation

The A1 foundation is opt-in with `OPENMELD_DESKTOP_PILOT=1`. It requires a
dev-local or canary lane and a configured loopback Web endpoint. Production
endpoints are rejected. The ordinary status/control renderer remains available
while A2 connects the shared Space entry.

Set `OPENMELD_DESKTOP_RENDERER_DIR` to the matching Web build's `dist/client`
directory to load its `/desktop-shell` route from local files. Without it, the
native build opens the small foundation sign-in entry. Build Web with
`OPENMELD_DESKTOP_PILOT=1`; its loader-free shell is emitted as `_shell.html`.
Main checks the emitted `desktop-build.json` against its own build identity
before opening shared assets; missing or stale assets stop startup.
The local protocol serves this shell for application routes and hashes its
packaged inline scripts for CSP. It never enables arbitrary inline scripts.

- Native entry: `clients/desktop/src/main/pilot.ts`.
- Local origin: `openmeld-desktop://app`; assets are read only from the built
  renderer directory. No hosted HTTPS-origin impersonation is used.
- Renderer interface: `src/shared/pilot-bridge.ts`, exposed as
  `window.openmeldDesktop`: platform, session, browser sign-in, Desktop sign-out.
  The response schemas and origin constants live in `packages/schemas`.
  `onSessionChanged(listener: () => void): () => void` emits only an
  invalidation and returns its listener cleanup. It runs after the installed
  Electron plugin persists the successful token exchange cookie, and after
  owned sign-out clears local credentials. The renderer rereads its existing
  session query; it does not rely on focus timing or maintain another session.
  Its Space stream methods open a subscription by ID/Space/Profile, send only
  the existing keepalive ping, close it, and deliver transport events. No URL,
  credentials, or business-write frames are accepted.
- Existing `window.openmeld` remains the CLI-backed local control interface.
  Every channel validates the owning WebContents, top frame, and local document
  before invoking a handler. Other windows, frames, and remote documents fail.
- Main retains context isolation, sandboxing, and disabled Node integration.
  New windows and renderer-initiated document navigation are denied.

Better Auth's matching Electron integration owns PKCE/state, system-browser
return, and encrypted cookie storage. Auth enables its additive Electron plugin
only in development. `/desktop-sign-in` uses normal Web login and an explicit
Continue in Desktop action. Main registers page and auth scheme privileges in
one Electron call, owns OS callback delivery, and passes callbacks to the vendor's
public `handleDeepLink` API. SDK scheme registration, unrestricted IPC handlers,
and the global CSP hook are disabled. Credentials never cross the
renderer bridge. Storage is scoped to the configured Web origin.

Desktop sign-out revokes the Desktop session; it does not run CLI logout.
The pilot exposes the independently read CLI account ID for comparison with its
cloud session. This comparison is display evidence, not the mutation fence.
The existing Computer surface offers Start/Stop only when the installed CLI and
actual macOS binary carrier positively advertise account-checked control.
The renderer sends the displayed account as immutable intent. Main verifies the
current native session, then passes that same account to the CLI admission owner.
An account change never retargets an operation. Stop has no GUI execution timeout;
the existing controlled shutdown owns drain and final completion.
Generic CLI login/logout, upgrades, autostart and agent mutations remain refused,
and tray Service controls stay hidden. Computer connection uses the bounded
native operation below; it does not reopen the old npm installer or unscoped
five-minute Setup wrapper.

### Computer connection

The shared Connect flow, including New Agent's embedded recovery, offers a
fixed `connectComputer` operation in Desktop. Its strict request contains the
displayed account and optional Human Profile/Space IDs only. Main validates its
current native account, reads the CLI-owned `computer connection-review --json`
projection, and reuses an account-aligned existing Service when that projection
positively identifies it. Reuse selects its actual device/lane; it does not
claim Agent Wakeability or rewrite a Computer session.

Fresh-session requests (including New Agent recovery) and source navigation
actions bypass that reuse shortcut. Source actions enter the existing Prepare
request unchanged. A requested `connectedComputerId` also bypasses reuse and
enters Prepare unchanged: Core validates account ownership, and the existing CLI
executor enrolls the current Service against that stable Computer identity.
New Agent must not derive this reconnect intent from a sole enrolled Computer,
account routing, a catalog selection, or a completed browser handoff. Ordinary
native connection leaves the target unspecified so the CLI uses its own Service
identity. The recovery picker (shown even for one saved Computer) and an explicit
session intent can select an existing Computer; the same resolved intent drives
both embedded setup and its recovery link.
Service updates and Space recovery stay in the Web flow until the native path supports their full intent;
Desktop offers the original route, or the original Space for a source action,
without reporting native completion. Once Prepare exists, later authorization,
account, execution, or snapshot failures retain its diagnostic correlation ID.

When the managed CLI is absent or lacks the connection contract, main downloads
the fixed Web origin's managed binary manifest and Apple silicon artifact.
The shared `@openmeld/local-service/cli-binary-update-artifact` implementation
verifies transport and executable hashes and the production signing identity.
The verified binary's `install-self` owns installation. No Node/npm prerequisite,
arbitrary renderer executable, URL, path, or shell command is accepted.

Main creates the existing Core Prepare Session and uses the shared API client's
Device Authorization sequence with its authenticated native SDK transport. The
grant creates an independent Computer session in the CLI; native cookies never
become CLI credentials. A different known account requires a native confirmation
dialog. Its intent names the exact reviewed old session identity and new account;
CLI checks both before entering its existing locked commit/rollback flow.

Setup runs without a GUI execution timeout, in a separate process group with
file-backed output. GUI exit does not stop it or the OS-managed Service. The
existing Prepare continuation journal and maintenance worker retain recovery
ownership. Completion requires CLI `setup.complete` and a completed Core Prepare
snapshot; errors retain a shared local-machine action and diagnostic correlation.

Production resolves the existing `~/.openmeld` managed installation. An installed
disposable build must compile its already aligned test lane using
`OPENMELD_DESKTOP_TEST_COMPUTER_HOME`, `OPENMELD_DESKTOP_TEST_AUTH_ORIGIN`, and
`OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN`. The build rejects the production home and
non-loopback test endpoints. These native-only values never enter the renderer
bridge or come from its launch environment. A build without that configuration
cannot connect a computer; it never creates a separate GUI-owned Service home.

Computer pages retain the shared connection and per-local-agent projections.
Native background controls are folded and appear only for a positively matching
device. Missing, unreadable, and explicitly different accounts remain distinct;
unavailable control capabilities are not evidence of an old version. A global
Connect this Mac action does not identify a selected remote Computer as local.

This pilot restriction applies to the shared Computer presentation and cloud
transport as well as native IPC. `canConfigureLocalComputer` removes unsupported
configuration actions while retaining reported status, details, and a Web handoff.
`pilot-local-control-policy.ts` rejects the exact Gateway method/path families
before attaching credentials: current and explicit Computer updates, local agent
configuration, maintenance, file access, local Project controls, enrollment,
rename/forget, and Prepare mutations. Catalog refresh is also unavailable in this
pilot; reading existing reports remains available. Ordinary Web and Space/Wake
mutations retain their existing contracts. These are pilot capability limits, not
new Core authorization rules.

After a positively acknowledged account-admitted Stop, CLI manager cleanup reuses
the completed drain instead of sending another shutdown to an exited carrier.
It rejects a different observed process owner; missing or failed drain evidence
does not enter this completion path.

The CLI prerequisite accepts `service start|stop --json --expected-account <id>`
for an already connected POSIX Service. Its owning admission contract is in
[Local OpenMeld Service](../architecture/local-openmeld-service.md#account-checked-service-start-and-stop).
This authorizes only existing-Service Start/Stop. Main rejects missing, changed,
unsupported or concurrent intent and preserves explicit CLI refusal or uncertainty.
`service control-capabilities --json` is a separate read-only query; it does not
extend the established strict status response. Version strings are not capability
evidence. Old, npm, non-macOS and unverifiable pairs omit usable controls.

## Cloud transport and compatibility

Native admitted `/v1/` requests use the Better Auth SDK's public fetch pipeline
and return the original response status/body through the credential-stripping
adapter. `patches/@better-auth__electron@1.6.30.patch` moves only the vendor's
response-cookie persistence and session signal from `onSuccess` to `onResponse`.
The pinned upstream otherwise loses legitimate renewal on 403/500 and deletion
on 401. Successful session-data caching and existing error notifications remain
unchanged. There is no app-side cookie jar or private SDK hook invocation.
Remove this patch when an adopted upstream version processes these cookies
before status handling, after rerunning the expiry/recreation and error matrix.
SDK recreation in tests does not prove real macOS safeStorage or OS restart.

Shared Profile and Organization business actions use fixed Web `/v1/` adapters:
Profile capabilities, Human/Agent creation, Agent-only deletion; Organization
creation/settings, invitations and member management; invitation links, public
join requests and Space invitations. They reuse Auth HTTP/Core owners and shared
schemas, never generated mutation IDs or renderer Better Auth calls. Membership
recovery reads the existing account Organization context. Account security
handoffs and native cookie/session storage remain separate.

The adapters preserve the incoming Origin, reject redirects, project safe JSON,
and forward separate vendor Set-Cookie headers only at the server HTTP boundary.
Auth's trusted-cookie-origin guard remains authoritative, including the exact
development Desktop origin. Installed production trust remains a separate
native transport prerequisite; these adapters do not relax it.

`pilot-protocol.ts` owns a fixed-endpoint request adapter:

Its header allowlist preserves shared Inbox, Space addressing, and Space access capability
negotiation. These version headers select an existing response contract; they
do not grant authorization. Renderer cookies and authorization remain excluded.

`pilot-transport.ts` owns one private persistent Electron Session shared by the
BrowserWindow and protocol handler. Its partition lives under the existing
isolated application data directory, so shared Web appearance preferences survive
normal GUI exit. HTTP caching stays disabled. Shared Web account-scoped read
cache authorization and sign-out cleanup still apply; native authentication
cookies remain in the separate main-owned SDK storage and are never forwarded
to the renderer. Before the page loads, it installs that
Session's sole `webRequest.onBeforeRequest` listener. Every local `/v1/` and
`/_serverFn/` request requires Chromium's current live owner WebContents ID,
exact main-frame identity, and trusted local document URL. Missing provenance,
child frames, other windows, remote documents, and top-level API navigations
are rejected before forwarding. Electron custom-protocol HTTP source headers
are absent and are not authorization evidence. Renderer headers grant nothing.

Do not attach another before-request listener to this Session: Electron keeps
only the last listener. The transport is its exclusive owner, rejects duplicate
installation, and removes the authenticated protocol handler before disposing
the listener. The ordinary Web/browser and default Electron Session are unchanged.
Run `pnpm --dir clients/desktop exec node scripts/verify-pilot-transport.mjs`
for the real Electron admission/zero-upstream regression matrix in disposable
storage; it never invokes CLI, Service, login, or a real Wake.

- `/v1/*` uses existing shared HTTP APIs through the matching Web gateway proxy.
  Core/Space still authorize every request. This is the portable business seam.
- Profile listing, account Space index/active-Wake summaries, and profile-Space
  history writes use the same typed HTTP consumers as browser Web. History
  updates preserve last-seen, pin and removal behavior; protected Space password
  persistence remains a separate unsupported pilot path.
- These consumers read `GET /v1/client-environment` from the configured Web
  endpoint for its current normalized `gatewayHost`. An installed renderer may
  have been built in another local lane, so build metadata and the local app
  origin must never supply this history namespace. Missing or invalid metadata
  stops the dependent request. The response is not persisted or an authority
  for identity, access, routing or execution.
- The shared account query reads Auth's strict `/v1/account/session` display
  projection through the shared API client, preserving the Joined date, email
  verification, and existing name/avatar cache updates. It never reads a generated
  server-function ID or receives credentials. Native entry/session/account fences
  retain their existing narrow bridge; account changes still reset the existing
  account query cache before rereading.
- Read-only `/_serverFn/*` calls are a bounded pilot compatibility dependency
  for remaining Web entry and public-Space handoff loaders.
  Sidebar geometry reads its local cookie during client navigation.
  Server-function mutations are refused;
  business writes must use the shared APIs.
- Generic Auth HTTP endpoints are not exposed to the renderer. Session management
  and account switching that return session tokens need a native adapter before
  entering the pilot surface.
- Main attaches its cookie only to the configured Web endpoint. It does not
  accept arbitrary URLs, credentials, file paths, shell commands, or redirects.
  Response cookie headers do not enter the renderer.
- Space live streams use the same fixed Web `/v1/spaces/:spaceId/stream`
  endpoint through native `ws`, with the main-owned cookie and build header.
  Redirects are refused. The preload sends only validated subscription events.
  Reload, renderer loss, native sign-in/sign-out, and GUI exit close native
  sockets; none of these operations stop the Service or a Wake.
  `clients/web/src/lib/spaces/live-transport.ts` adapts this transport to the
  existing Space feed listener contract. That shared feed still owns hello
  acknowledgement, keepalive, reconnect, invalidation and snapshot refresh.
  It does not replace global WebSocket or add a Desktop live-state system.
- The app origin is explicitly allowed by the development Auth configuration and
  pilot Web CSRF policy. CSRF is not disabled; Origin alone grants no authority.
- The Web server compares a content fingerprint from
  `scripts/desktop/web-build-identity.mjs` before handling Desktop requests.
  A mismatch returns HTTP 409 before the operation. The fingerprint covers Web,
  shared packages, lockfile, and the fingerprint helper, excluding generated
  route-tree output.
  Ordinary Web development/builds do not compute a pilot fingerprint. An
  unstaged deletion and the same staged deletion produce the same identity.

This is **not a production Desktop/Web compatibility contract**. Pilot renderer
and Web server must be production-mode builds of matching source; Vite's dev
server uses a different server-function registry. A later Web deployment that
changes the fingerprint makes this pilot fail closed. It cannot silently invoke
a different function or submit a write. Production distribution must replace
remaining build-coupled calls with durable API adapters or a versioned server
compatibility contract. Do not rewrite all Web server functions for this pilot.

A2 owns the actual shared Space entry, platform presentation, and one integrated
Web/Desktop smoke. A1 foundation/build checks alone do not prove a real Wake,
published reply, or Service continuation after GUI exit.

## CLI and Service control

Reuse the CLI's machine-readable status, setup, service, and agent commands.
Setup streams Agent View events and ends in `setup.complete`; its shared
`serviceGuidance` and LocalMachineIssue messages remain authoritative. Do not
classify raw OS errors or add Desktop-only repair/retry state.

Normal UI status refresh is read-only. Home and Settings Computers reuse the
same local-management surface. General owns GUI preferences; Computers owns
CLI-backed Service controls. Service autostart and GUI launch-at-login are
different preferences with different writers.

## Development lanes

Use repo-root Desktop scripts when interacting with CLI, Service, or Web:

- `pnpm desktop:dev` and `pnpm desktop:start:dev` build and launch Desktop
  using this worktree's registered isolated lane and its installed
  `<OPENMELD_HOME>/bin/openmeld`; they do not install a global CLI.
- `pnpm desktop:canary` and `pnpm desktop:start:canary` use the same guarded
  lane resolution with the explicit canary preset.
- Production reproduction requires explicit authorization for
  `pnpm desktop:start:prod`; it is not a pilot command.

These commands align CLI, home, auth, Gateway, and Web. An isolated worktree must
use its actual aligned URLs and OS Service identity, not production state with
only an overridden home. Follow `development-workflow.md` for lane ownership.
Do not reset or re-register the user's production Service for tests.

Start the Worker lane with `pnpm dev:worktree` and complete its normal Web setup.
For the shared Desktop pilot, start Web in another terminal with
`OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree`. This reuses the existing Web
lane reservation and Doppler owner but builds and serves compiled Web output.
Stop only that worktree's old Web process first if it is already running.
The preview listener binds `127.0.0.1` so TanStack can prerender its shell;
the configured Web/Auth/Gateway URLs still use the worktree hostname and ports.
Then run `pnpm desktop:start:dev`. Missing/stale lane ownership or a missing
lane-local executable stops startup without falling back to production/global
state. Rebuild Web after source changes before relaunching Desktop.

For a blank pilot window, use
`OPENMELD_DESKTOP_DIAGNOSTICS=1 pnpm desktop:start:dev`. This opens local Electron
DevTools and reports load milestones, preload failure, renderer exit, and fixed
console error categories. Terminal output excludes console text, URLs, request
bodies, and credentials. Inspect the full error locally in DevTools. This entry
requires the validated local pilot and an unpackaged app; it does not expose a
remote debugging listener or enable diagnostics in packaged builds.
Use **Developer > Reopen Developer Tools** to recreate a closed or minimized
inspector without reloading the application; only inspector history is reset.
The local pilot Web build leaves client JavaScript unminified so DevTools can
set exact line breakpoints in hydration and application error callbacks. Normal
Web builds retain their default minification.

GUI data lives under `<OPENMELD_HOME>/desktop/user-data`. Main sets and verifies
Electron's `userData` path before Better Auth constructs storage. The launcher
also passes that directory explicitly to Electron, keeping GUI preferences and
credentials separate from other worktrees.

Electron 44.3.0 is paired with electron-vite 5.0.0 and Vite 7.3.2. Hydrate the
native binary with `pnpm --filter @openmeld/desktop exec electron --version`.
Electron is deliberately separate from the root Worker development stack.

## Packaging and release boundary

Public Desktop distribution remains paused: `/desktop` returns 404. Do not
publish or deploy this pilot as a production release.

Local macOS packages use electron-builder's standard ad-hoc signing
(`mac.identity: "-"`) for the assembled App and nested code. The shared build
requires signing and strict verification before creating the DMG; installed and
private targets inherit this policy. Do not set `identity: null`: the original
Electron executable's linker signature does not seal the application resources.
No post-build signature repair is required or supported. The builder's default
Electron entitlements support JIT and library loading with Hardened Runtime.

The existing `unsigned` command and artifact names mean no Developer ID signing.
Ad-hoc integrity is not Developer ID trust, notarization, or Gatekeeper acceptance.
Notarization remains disabled for default development artifacts. Before installation
acceptance, verify both the source App and its DMG copy with
`codesign --verify --deep --strict --verbose=2`, then use the normal macOS Open
flow with quarantine preserved. A valid signature does not prove visible startup,
login, or Service behavior; report those outcomes separately.

For an authorized local installation acceptance, use
`pnpm desktop:package:acceptance` with the existing disposable target and fixed
Web origin. This invokes the same installed packaging pipeline and validates the
same renderer fingerprint. The installed builder configuration selects the
existing SOPHIAPRO Developer ID and `openmeld-notary` Keychain profile from the
Apple release credential contract. Competing file/password credentials are
rejected; no certificate is created or exported. Builder signs nested code,
submits the App to Apple, staples the accepted ticket to the App, and then creates
a signed `-acceptance.dmg` under `clients/desktop/dist/acceptance`. The ticket
covers the App copied out of that DMG; the container has no separately stapled
ticket. No renderer or account data is changed, and publishing remains disabled.
Verify the copied App's strict signature, stapled ticket and Gatekeeper assessment
before the normal download/Finder/native batch. This command contacts Apple's
notary service but does not authorize public distribution or deployment.
Use `DEBUG=electron-notarize:notarytool` for a local evidence run to retain the
Apple submission ID and Accepted result in the build log. Compute final artifact
hashes only after notarization, stapling and DMG creation have completed.

### Installed macOS entry

`OPENMELD_DESKTOP_TARGET=production` compiles the installed entry for
`https://openmeld.ai`. The shared renderer, native main, and package marker must
agree on this target and source fingerprint. The fingerprint verifies local
assets; it is not an installed client's server admission token. Finder launch
reads packaged assets and normal macOS application data without a repository,
pnpm, CLI prerequisite, or launch-time lane/URL/storage configuration.

Production uses app ID and callback scheme `sh.openmeld.desktop`, SDK client ID
`openmeld-desktop`, and `OpenMeld Desktop` under the OS application-data directory.
User data is fixed before initializing the SDK's encrypted cookie storage.
`OPENMELD_DESKTOP_TARGET=disposable` is a separately compiled local test target:
its fixed loopback Web origin comes from `OPENMELD_DESKTOP_TEST_WEB_ORIGIN`, and
its app ID, callback, SDK client ID, and data directory use the distinct test
identity. The production target never consumes that endpoint override.

An isolated disposable Web/Auth backend must explicitly configure
`AUTH_DESKTOP_DEVELOPMENT_TARGET=disposable` on both services. Empty or `private`
development configuration preserves the existing `electron` client and
`sh.openmeld.desktop.dev` callback. Production rejects a nonempty development
target. Better Auth supports one Electron client identity per Auth instance;
do not combine test and private identities by registering duplicate plugins.
Browser sign-in validates that configured identity, displays the intended
account, and preserves the normal add-account entry when another account is
needed. Invalid or expired native returns require a fresh browser sign-in.

Installed requests carry `x-openmeld-desktop-contract: 1`; before authenticated
business reads or streams, native verifies the strict, no-store
`GET /v1/desktop/compatibility` response. Compatible Web deployments retain
contract version 1 without requiring identical build fingerprints. Missing,
unknown, or malformed compatibility blocks admission; connectivity failures
remain distinct from unsupported-version messages. This admits representations,
not users: existing Auth/Core/Space authorization remains authoritative.
Installed renderers cannot call generated `/_serverFn/` or generic `/api/`
endpoints. They consume explicit `/v1/` contracts, including CLI release metadata
from the existing binary-channel manifest at `GET /v1/cli/release`.
The fixed native Computer connection operation additionally admits only
`POST /api/auth/device/code`, `GET /api/auth/device`, and
`POST /api/auth/device/approve` through Web's representation guard. The existing
Auth handlers retain authorization and grant validation. Renderer protocol
requests to all `/api/` paths, including these three, remain rejected before
native credentials are attached.

After building the matching shared Web renderer, `pnpm desktop:package:installed`
stages it and builds a local unsigned arm64 DMG with no publication target.
Installable entry is separate from Service bootstrap and signed distribution:
existing-user Service reuse, new-user zero-setup connection, actual Wake outcomes,
signing, notarization, and installed native acceptance remain separate gates.
Do not expose the paused public download page based on package construction.

Release ordering is server first: deploy the matching Web admission/metadata
routes and Auth identity before distributing an installed app. Keep contract 1
available while supported installed apps use it. Roll back incompatible Web/Auth
changes before withdrawing a supported representation; never redirect native
credentials to another origin or use a fingerprint bypass as recovery.

### Private local macOS package

`pnpm desktop:package:private` builds the private unsigned macOS arm64 app and
DMG with the existing electron-builder. It requires installed workspace
dependencies and current pilot Web output in `clients/web/dist/client` (build
through `OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree` in the configured lane,
as in the lane workflow above). Setting the pilot flag alone is insufficient:
the guarded Web entry supplies the actual lane's `VITE_BETTER_AUTH_URL` and
other aligned build values. Pilot builds reject a missing or invalid client Auth
URL after normal Vite environment loading, before emitting output. Runtime
native environment variables cannot repair a missing compiled renderer value.
Missing, incomplete, or stale Web output stops packaging. The package command
never starts Web or a Service.

The build stages the shared client output without source maps or hidden files,
rejects symbolic links, and includes it at `Contents/Resources/desktop-renderer`.
The private target includes main/preload and icons, but excludes the old status
and foundation renderers. Its compiled private mode requires the guarded pilot
entry even when started without environment configuration; it cannot fall back
to the status UI. Native startup always resolves this package's own resources,
ignores external renderer overrides, and checks the same Web build identity
before creating authentication storage. The existing Web-side build check still
rejects a mismatched server before forwarding an operation.
The app's `Info.plist` declares the existing development Auth return scheme from
`packages/schemas`, as macOS requires for packaged URL callbacks; no new scheme
or Auth authority is introduced.

Output is under `clients/desktop/dist/private`, with `Private` in both app and
DMG names. This target writes no preview/update manifest and has no publisher.
It does not bundle CLI, Service, credentials, lane state, or worktree asset paths.
The legacy preview build remains a separate paused distribution path.

Launch the built or copied app from an already configured, matching worktree:

```sh
pnpm desktop:start:package "/path/to/OpenMeld Desktop Private.app"
# Explicit canary preset, using the same worktree lane:
pnpm desktop:start:package "/path/to/OpenMeld Desktop Private.app" canary
```

This extends the existing root launcher: it verifies lane ownership and the
lane-local CLI, supplies aligned loopback endpoints and isolated GUI storage,
then runs the packaged executable without rebuilding it. Finder launch alone
has no lane configuration and is refused. A matching compiled Web server and
an existing connected CLI/Service remain prerequisites; this is not clean-machine
setup or a production compatibility promise. Auth, IPC, transport and protected
Service-control gates are unchanged. Signing, notarization, Gatekeeper behavior,
authenticated packaged UI, and OS browser-return callbacks need separate native
acceptance; package construction and content checks do not prove those outcomes.

The existing preview pipeline builds an unsigned Apple silicon DMG with
`pnpm release:desktop-preview:build` and electron-builder. Its upload command
targets production R2 and requires separate release authorization.
The old preview installer uses global npm/Node for CLI installation; this is not
a claim of a bundled, signed, self-contained Desktop/Service distribution.

Reuse the established CLI binary and Apple signing mechanisms when completing
distribution; do not create another release credential or update system.
Developer ID presence, Doppler names, portal access, build success, signing,
notarization, installation, and visible product smoke are separate evidence.
Desktop versions remain diagnostics and app-update facts, never Wake gates.
