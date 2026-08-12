# Desktop GUI Client

## Agent Context

- Purpose: Define the OpenMeld Desktop GUI client's responsibility boundary as a thin,
  always-on local control surface for the OpenMeld Service — no-terminal setup, service
  status, start/stop, auto-restart presence, agent on/off, and a menu-bar tray.
  It drives the CLI; it does not reimplement it.
- Read this when: You are building or changing the Desktop GUI (Electron main or
  renderer), its tray, onboarding, status surface, update affordance, packaging,
  or how it talks to the CLI/daemon.
- Update this when: Desktop responsibilities, boundaries, the GUI↔CLI contract,
  the update model, or the Phase-1 scope change.
- Do not use this for: Space/Account UI (those open Web), daemon internals (see
  `developing/architecture/local-openmeld-service.md`), CLI command model (`cli.md`),
  Web UI (`web.md`), or release gates.
- Source of truth: This file owns the durable client boundary for the OpenMeld Desktop GUI.

## Current design state

The rule-level boundaries below are decided and authoritative alongside
`cli.md` and `web.md`. The detailed UI and packaging design remains intentionally
lightweight until the Desktop build advances.

## Positioning

> OpenMeld Desktop = the OpenMeld Service's always-on local presence + a no-terminal
> setup/status control surface. It drives the CLI, reads the single source of
> truth, and hands Space/Account off to Web.

It IS:

- a thin local control surface for the OpenMeld Service (install / status / start-stop /
  auto-restart presence / one-tap update / agent on-off / tray).
- a driver of the `openmeld` CLI's machine-readable surface, not a reimplementation.

It IS NOT:

- a Space or Account client — those open Web (`https://openmeld.ai/...`).
- an owner of any state, nor a second source of truth for anything.
- an independent client with its own state machine.

The three surfaces — CLI, Web, Desktop — are peers over one backend. Web is by
design, not a fallback.

## Boundary (red lines)

- The GUI reads projections (`openmeld service status --json`,
  `agents detect/list/show --json`); it never probes or computes
  liveness/readiness itself.
- The GUI changes agent on/off only through the single writer
  `updateAgentRegistrations` (via the CLI). It must never introduce a second
  writer of `controllers[].enabled`, and never write that fact directly.
- The GUI is a setup driver (blessed by `local-openmeld-service.md`). It must never
  become a Wake gate, a Binding/Space truth owner, or a second liveness source.
- Mutations are explicit/user-visible per `cli.md`; the GUI may run setup/repair on
  the user's behalf (invisible-to-user is fine) but must not silently mutate from a
  status/read path. Full-silent service mutation needs an owner ruling first.
- GUI lifecycle ≠ Service lifecycle: the Service runs (and auto-restarts) via the OS
  service manager regardless of whether the GUI window is open.

## Architecture

- Two processes:
  - Main (Node): drives the CLI (shell-out to `openmeld … --json` and/or the daemon
    socket), owns the tray, and manages the GUI app lifecycle. The CLI's embedded-vs-system
    Node and the daemon's independent lifetime are packaging concerns (see below).
  - Renderer (Chromium): a small React app for onboarding/status — NOT the web app
    embedded in a window. It reuses shared UI components, not whole web pages.
- GUI↔CLI contract: the machine-readable `--json` surface (see
  `clients/openmeld-cli/COMMAND_CONTRACTS.md` → "Machine-readable output"). Success =
  one `{schemaVersion, type, ...}` line + exit 0; failure = one `{type:"error",
error:{code,message}}` line + exit 1. This surface is complete.
- Setup is the one exception that still streams Agent View events and completes
  with `setup.complete`. Desktop must parse `setup.complete.serviceGuidance` for
  service lifecycle transparency after setup/reconnect instead of copying CLI
  Human View cards into GUI code.
- When that stream contains a shared `LocalMachineIssue` error event, Desktop
  presents its exact plain-language message and primary action instead of
  replacing it with a generic setup failure. Desktop does not classify raw
  operating-system errors or perform a hidden retry; the CLI remains the only
  local-machine recovery owner.
- Setup guidance in the Desktop GUI must be GUI-first. The CLI may return
  command strings for diagnostics and CLI users, but Desktop should present the
  corresponding GUI control or status explanation instead of asking users to run
  terminal commands.
- Desktop must not invent a Desktop-only setup progress UI or wording. The
  intended path is to let the Web setup experience settle, then extract/reuse
  the shared setup model and Web UI pieces so Web and Desktop present the same
  setup steps, statuses, and completion experience.
- Visible Desktop state must refresh automatically while the app is open; users
  must not need to discover or press Refresh for normal status truth. The live
  refresh set is auth status, OpenMeld Service status, local agents, and Desktop
  preferences. Desktop update status is also refreshed automatically, but on a
  slower cadence because it can involve release/update checks. Refresh reads are
  read-only and must not mutate service lifecycle, agent enablement, login
  state, or setup state.
- Home and Settings → Computers must render the same local-management surface
  for OpenMeld Service and local agents. First-run setup, stopped service, and running
  service states may adjust the primary CTA, but they must reuse the same
  service card, local-agent card, CLI-backed actions, and view contract instead
  of maintaining a parallel Home-only status implementation.
- Settings → General is an overview and Desktop-owned app-preferences surface,
  not a second control plane. It may link to Account and Computers and may own
  Electron-only preferences such as opening OpenMeld Desktop at login. Local sign-in
  and sign-out actions live in Account. OpenMeld Service lifecycle, service
  auto-start, reconnect, and local-agent controls live in Computers.

## Local Development Lanes

Desktop local development must use explicit repo-root scripts when the GUI talks
to the CLI, OpenMeld Service, or OpenMeld Web. Plain `pnpm -C clients/desktop dev` is only
for Electron-only work where lane alignment is irrelevant.

Root `pnpm dev` starts the local Auth/Core/Gateway/package watcher stack. It
intentionally excludes both Web and Desktop so browser UI and Electron UI can be
started, stopped, and debugged independently.

### Electron Runtime Binary

`electron-vite dev` is the correct Desktop development command. It builds the
main process and preload scripts, starts the renderer dev server, then launches
the Electron app.

Electron itself is a native desktop runtime, not only JavaScript build output.
Electron 42 and newer download the local Electron binary on first run instead of
relying on package-manager `postinstall`. A missing
`node_modules/.../electron/dist/Electron.app` is therefore Desktop dependency
hydration, not an OpenMeld Auth/Core/Gateway/Web stack failure.

Do not add OpenMeld Desktop back to root `pnpm dev` to hide this dependency boundary.
If Desktop reports a missing or uninstalled Electron binary, hydrate it in the
Desktop lane:

```sh
pnpm install
pnpm --filter @openmeld/desktop exec electron --version
pnpm dev:desktop
```

Use:

- `pnpm dev:desktop` — alias for `pnpm run desktop:dev`.
- `pnpm run desktop:dev` — build/install `openmeld-dev`, then start Electron against
  the repo-local development lane (`OPENMELD_ENV_PRESET=dev-local`, `openmeld-dev`,
  `~/.openmeld-dev`, local Gateway/Auth/Web).
- `pnpm run desktop:start:dev` — start Electron against the already-installed
  `openmeld-dev` wrapper without rebuilding it.
- `pnpm run desktop:canary` — build/install `openmeld-canary`, then start Electron
  against the packaged candidate lane (`OPENMELD_ENV_PRESET=canary`,
  `~/.openmeld-canary`, local Gateway/Auth/Web). This path can run package
  release-readiness checks through `npm pack`.
- `pnpm run desktop:start:canary` — start Electron against an already-installed
  `openmeld-canary` wrapper.
- `pnpm run desktop:start:prod` — start Electron against the published
  production lane (`openmeld`, `~/.openmeld`, `https://openmeld.ai`) only when explicitly
  reproducing production behavior.

The scripts intentionally set `OPENMELD_BIN`, `OPENMELD_ENV_PRESET`,
`OPENMELD_USER_FACING_CLI_COMMAND`, `OPENMELD_GATEWAY_URL`, `OPENMELD_AUTH_URL`, and
`WEB_APP_URL` together. A dev/canary GUI must not drive a production CLI or open
production Web by accident.

## Phase 1 scope (minimal viable)

The smallest thing that replaces "user types CLI commands to set up + check the service":

1. Login → device flow → open Web (existing CLI auth; GUI `openExternal`).
2. Setup: detect local agents (`agents detect --json`) → user picks which to enable →
   run `openmeld service install` + enable. The Service is now installed → OS-level
   auto-restart is included for free.
3. Status: read `service status --json` and `openmeld agents show --json` facts →
   show running/stopped, which agents are enabled, and any read-only local
   controller update advisory with the manual command the user can run on this
   Mac.
4. Tray: menu-bar icon (running/stopped) + quick actions (open status window,
   start/stop, quit, open Web).
5. Small links: New Space / Account → `openExternal` to Web.

A v0.1 skeleton (to validate the thin-wrapper path): tray presence + status +
one-button setup + "open OpenMeld on the web".

## Non-goals (Phase 1)

- No GUI-level watchdog (redundant with OS KeepAlive).
- No Space/Account UI (open Web).
- No direct service-behavior writer in Desktop. Desktop may expose a
  CLI-backed service preference such as "Start OpenMeld Service automatically", but
  the write must route through the CLI/service contract
  (`openmeld service autostart enable|disable`) and Desktop must read the resulting
  service-manager projection from `service status --json`.
- GUI-app launch-at-login is a Desktop-owned preference in Settings General; it
  starts the tray app after user login and does not change OpenMeld Service autostart.
- No CLI self-contained binary yet (A2/A3 shelved — see below).

## Auto-restart & config boundary

- Auto-restart is provided by the OS service manager (launchd `KeepAlive` /
  systemd `Restart=always` / Windows recovery) that `openmeld service install` sets up.
  After shutdown→power-on (and login, since it is a per-user agent), the Service
  comes back automatically. The GUI does not implement restart logic; it ensures
  the Service is installed, surfaces status, and offers a manual restart/repair
  button as a fallback.
- Robustness caveat: this auto-restart's reliability depends on the daemon exec
  path staying valid. The launchd path should stay on the OpenMeld-owned service
  wrapper instead of a transient Node or repo-local script path.
- Service-behavior config (KeepAlive, heartbeat, lane) is owned by the CLI/service,
  written via `service install`/`repair`. The GUI must not own a second copy.
- Service autostart is a CLI/service-owned preference. Desktop may show the
  current OS service-manager enabled state and call
  `openmeld service autostart enable|disable`, but it must not edit launchd,
  systemd, Windows Service config, service contracts, or lane state directly.
  Enabling or disabling service autostart must not start or stop the currently
  running OpenMeld Service process.
- GUI-app config is legitimately GUI-owned and user-configurable when it is about
  the GUI app, not OpenMeld Service behavior. Settings General owns "Open OpenMeld Desktop
  at login" through Electron's `app.getLoginItemSettings` /
  `app.setLoginItemSettings`. This only brings the Desktop tray app back after
  user login; it never edits launchd/systemd service autostart, KeepAlive, OpenMeld
  lane state, or service lifecycle truth. Note the two distinct "launch at login":
  the Service's (KeepAlive, CLI-owned, default on) vs the GUI app's (puts the tray
  back after reboot, GUI-owned, optional).

## Versioning & updates

- Reuse the Local Components manifest (`release/local-components.json`); do not
  build a parallel system. Add a 4th component `desktop` (the app shell only) with
  `appVersion`, a distinct `desktopContractVersion`, `updatePolicy`, and a
  per-component `updateChannel` ∈ {setup | self-update | refresh}.
- Update UX: one-tap "Update OpenMeld Service" (decided; no full-silent). All surfaces
  render the same "current vX / need vY / [one-tap]" pattern; channel decides the action.
- `desktop` is diagnostics/self-update only — NEVER a Wake gate (a healthy daemon
  must not be blocked because the GUI shell is old).

## Login

Device flow → open Web. The GUI can drive the device-flow HTTP + `openExternal`
directly; it does not need a headless `auth login`.

## Code sharing

- Incremental (build Desktop, sink shared bits into a package as needed; Web migrates
  opportunistically). Do not do a big upfront Web extraction.
- Design language is abstracted first: the shared `packages/ui` package holding the
  shadcn base + global CSS + Tailwind config (follow shadcn's current monorepo guidance).
- The renderer reuses shared components (a stepper component may be extracted from
  Web), NOT the whole Web app. UI can be many (Web stepper / GUI stepper / CLI
  multiselect); the writer is one (`updateAgentRegistrations`); selection writes
  `selectedLocalAgentIds`, enable stays CLI/Service.

## Decide-now (irrecoverable, or cheap-now / expensive-and-breaking-later)

- A GUI version beacon: the first shipped GUI must report `appVersion` +
  `desktopContractVersion` upward (piggyback the daemon heartbeat) so the server can
  observe in-the-wild GUI versions. Once GUIs ship without it, forcing an old GUI to
  update is a permanent dead-end. ~free now (`app.getVersion()`).
- Reserve the manifest schema: an `.optional()` `desktop` component + `updateChannel`,
  bump `LOCAL_COMPONENTS_SCHEMA_VERSION`, deploy strictly web→gateway→core (the
  manifest is import-baked into already-published CLIs that re-validate it).
- Owner-doc line (same PR): `desktop` is diagnostics/self-update only, never a Wake gate.

## Build-later

- Electron self-update wiring (electron-updater/Sparkle, signing, staging).
- CLI self-contained binary + daemon-path parameterization (A2/A3) — a focused
  workstream after the concurrent CLI churn settles. A2 = stop pinning the daemon to
  a fragile node path; pin it to a stable owned binary. This hardens auto-restart.
- Turning `desktop` into a real runtime gate (additive reader + owner-doc edit).
- Niche `--json` completion (`upgrade`/space "handled" error branches).

## Owner boundaries

- Desktop owns: the GUI app (tray, onboarding/status windows, GUI-app prefs), and
  the `desktop` release component (app shell version + self-update).
- Desktop does NOT own: the Service lifecycle/config (CLI), agent enable truth
  (`updateAgentRegistrations`), readiness/Wake (Core), Space/Account (Web).

## Open decisions

- Renderer strategy: LOCKED to "own small React app reusing shared components"
  (not embed the Web app).
- Binary tooling (when A2/A3 is built): Node SEA vs `@yao-pkg/pkg` vs bun — bun is
  blocked by `import.meta.url` self-location in `skills/bundled.ts` /
  `registry-source.ts` / `daemon-service-bundle.ts` (refactor first); SEA/pkg work today.
- Beacon transport: extend the daemon register/heartbeat request to carry the GUI
  appVersion vs a new lightweight report — decide at build start.

## Verification ledger

- CLI machine surface (`--json`): complete + green (81 tests). `service start --json`
  has no integration test (its action wrapper in `openmeld.ts` is not import-unit-testable)
  → pending a manual smoke (`openmeld service start --json`) after the concurrent CLI work
  (cli-split / agent-select prereq) stabilizes.

## Release & distribution (Phase 1)

Distribution is currently paused. The public `/desktop` entry deliberately returns
404, and no production preview artifact is published. Keep the existing release
page and artifact pipeline dormant until Desktop passes real-device production
smoke and the product owner explicitly approves distribution.

Current MVP (2026-06-23):

- Build only macOS Apple silicon: `OpenMeld-Desktop-<version>-macos-arm64-unsigned.dmg`.
- Use `electron-builder` from the existing `electron-vite` package. It keeps the
  current app structure and adds the smallest distribution surface.
- Ship unsigned and not notarized. The Web download page must say this clearly and
  show the macOS Privacy & Security / Control-click open path.
- Host the artifact in the private R2 bucket `openmeld-desktop-downloads`. Production
  Web streams it through `/desktop/download`, so the user-facing URL stays on
  `https://openmeld.ai`.
- Publish the preview release projection to the private R2 object
  `desktop/update.json`; production Web serves `/desktop/update.json` from that
  projection and streams the object named by the manifest through
  `/desktop/download`. The first GUI does not self-update in place; it checks the
  manifest, shows a new-version prompt, and opens `/desktop`.
- Do not embed a CLI binary in the first release. Node.js LTS with npm is a
  requirement for this preview. If Node/npm is missing, Desktop opens the Node.js
  download page. If `openmeld` is missing or old, Desktop installs or upgrades the
  global CLI through npm and then runs the existing CLI setup/service path.
- First-run Desktop copy must stay app-driven. It can state the Node.js LTS
  requirement, but it must not ask users to run `npm`, `npx`, `openmeld setup`, or
  other terminal commands manually. After Node/npm are available, Desktop owns
  the visible install, update, and setup actions.

This is intentionally smaller than signed auto-update, but it preserves the
long-term shape: official Web download page, R2-backed artifact storage, app-level
version manifest, and Desktop as a thin CLI/setup driver.

Build and upload:

```text
pnpm run release:desktop-preview:build
pnpm run release:desktop-preview:upload
```

The upload command targets only the production R2 bucket. Local development only
needs the build command.

Future production launch:

- Add Developer ID signing and Apple notarization.
- Add a signed self-update feed through `electron-updater` or an equivalent
  native update path.
- Add Intel/universal macOS only when there is a real user need; the first preview
  is Apple silicon only.
- Replace the npm global CLI dependency with an owned CLI/service binary after the
  daemon path and service install contracts are ready.

### Unsigned preview option (early channel)

Shipping unsigned is acceptable for an early/preview channel IF users are clearly
warned, with these UX realities:

- macOS (harsh): an un-notarized app is quarantined; modern macOS routes the user
  through System Settings → Privacy & Security → "Open Anyway" (the old
  right-click→Open shortcut is gone on recent versions). Telling users to
  `xattr -dr com.apple.quarantine` is a terminal step — ironic for a no-terminal
  GUI; do not make it the primary path.
- Windows: SmartScreen "Windows protected your PC" → More info → Run anyway. Mild.
- Linux (`.AppImage`): no gate; `chmod +x`.

Verdict: fine for technical early adopters / a clearly-labeled "preview" build; not
for a polished public launch. The download page must show per-OS "how to open" steps.
Skipping signing lowers the PRODUCT bar (warning vs blocked); it does NOT remove the
need for a real build host (a Mac to build the `.dmg`) or a manual GUI smoke.

Minimum first-round smoke:

1. Build: `pnpm run release:desktop-preview:build`.
2. Install: open the DMG and drag OpenMeld Desktop to Applications.
3. First open: confirm the app name, Dock icon, menu name, and About panel say
   `OpenMeld Desktop`, not Electron or `@openmeld/desktop`.
4. Gatekeeper: confirm the unsigned warning path documented on `/desktop` works.
5. Missing Node: on a machine without `node`/`npm`, confirm Desktop asks for Node.js
   and opens the Node.js download page.
6. Missing CLI: with Node/npm present and no `openmeld`, confirm Desktop installs the
   global CLI through npm.
7. Old CLI: with an older `openmeld`, confirm Desktop offers the update action and
   returns to a stable status after upgrade.
8. Setup: choose Set Up This Mac and verify the OpenMeld Service starts through the CLI
   contract.
9. Web handoff: open OpenMeld Web, create a Space, add Profiles, and wake a local agent.
10. Update awareness: temporarily point `OPENMELD_DESKTOP_UPDATE_MANIFEST_URL` at a
    higher-version manifest and confirm Desktop opens `/desktop` from the prompt.
11. R2 round trip: upload the production artifact, deploy Web, download through
    `https://openmeld.ai/desktop/download`, and verify the SHA-256 matches the build log.

## Phase-1 build plan & verification layers

Layered by what can be verified without a display / build-host vs what needs Felix +
a real machine. Build bottom-up.

| Layer                   | What                                                                                    | Autonomously verifiable?                                         |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| L1 CLI-driver core      | spawn `openmeld … --json`, parse the envelope, typed results, exit-code map                  | YES — unit tests (mock child_process)                            |
| L2 State model          | status/agents `--json` → GUI view-state (running/stopped, agent list, update-available) | YES — pure-function unit tests                                   |
| L3 Renderer components  | React onboarding/status views reusing the design language                               | PARTIAL — jsdom component tests (render logic), not the real app |
| L4 Electron main wiring | tray, window, IPC, openExternal, app lifecycle                                          | NO — needs Electron runtime + display                            |
| L5 Build / package      | electron-builder config, unsigned per-platform artifacts                                | NO — needs a build host (Mac for `.dmg`)                         |
| L6 Smoke + publish      | launch app, click tray, walk onboarding, see service start; upload to R2                | NO — needs a real machine + Felix sign-off                       |

Autonomous max = **L1 + L2 fully tested + L3 component tests**. L4–L6 need Felix / a
real machine. L1–L2 are contract-bound (the `--json` surface is frozen by tests), so
building them does NOT depend on the in-flux CLI internals — they are the one piece
safe to build ahead of CLI stabilization.
