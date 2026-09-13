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
Continue in Desktop action. Main installs the vendor protocol handling but not
its unrestricted IPC handlers or global CSP hook. Credentials never cross the
renderer bridge. Storage is scoped to the configured Web origin.

Desktop sign-out revokes the Desktop session; it does not run CLI logout.
The pilot exposes the independently read CLI account ID for comparison with its
cloud session. This comparison is not an atomic authorization fence: a local
account can change before a separately invoked command. Therefore the pilot
refuses all local CLI login/logout, installation, Service and agent mutations,
and hides tray Service controls. It reuses an already configured independent
Service. Enabling those controls requires an expected-account contract at the
CLI mutation owner; do not treat a preceding read as that contract. Clean-machine
setup remains the normal Web/CLI onboarding path, not a completed Desktop flow.

## Cloud transport and compatibility

`pilot-protocol.ts` owns a fixed-endpoint request adapter:

- `/v1/*` uses existing shared HTTP APIs through the matching Web gateway proxy.
  Core/Space still authorize every request. This is the portable business seam.
- Read-only `/_serverFn/*` calls are a bounded pilot compatibility dependency
  for existing Web loaders (session, Organization scope, current profile,
  account Space index, and sidebar state). Server-function mutations are refused;
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
