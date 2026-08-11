# @openmeld/desktop

OpenMeld Desktop GUI (Electron) — a thin, always-on local control surface for the OpenMeld
Service. It drives the `openmeld` CLI's machine-readable (`--json`) surface; it does not
reimplement it. Space/Account open the Web. See the owner doc:
`developing/clients/desktop.md`.

## Status (Phase-1 L4)

This package currently holds the Phase-1 L1-L4 desktop core:

- **L1 — CLI driver** (`src/main/cli/`): spawn `openmeld … --json`, parse the canonical
  envelope into typed results, map exit codes. Unit-tested.
- **L2 — state model** (`src/main/state/`): turn the `--json` results into GUI
  view-state (running/stopped, agents, update-available). Pure, unit-tested.
- **L3 — renderer components** (`src/renderer/`): React onboarding/status views over
  the IPC contract. Component-tested (jsdom).
- **L4 — Electron wiring** (`src/main/main.ts`, `src/preload/`): Electron
  BrowserWindow, tray/menu, preload bridge, and main-process IPC handlers that
  reuse L1 + L2. Unit-tested where display-free.

Not yet built:

- **L5** packaging (electron-builder; signing/notarization).
- **L6** GUI smoke + publish (Cloudflare R2 + electron-updater).

See `developing/clients/desktop.md` → "Phase-1 build plan & verification layers".

## Current CLI entry-check behavior

Blocked CLI entry-checks now emit the canonical `--json` error envelope. The
contract lives in `clients/openmeld-cli/COMMAND_CONTRACTS.md` and
`packages/schemas/src/schemas/cli/json-output.ts`: when sign-in, profile,
local-state repair, or required-update checks block under `--json`, the CLI prints
exactly one `{schemaVersion:1,type:"error",error:{code,message,requestId?}}`
envelope and exits 1. Desktop L1 maps that envelope to `cli_error`, so the GUI can
surface the real cause instead of a generic `parse_failed`.

Do not reintroduce the stale assumption that blocked entry-checks are a Desktop
pre-ship blocker. If a future command produces presenter output or another
non-envelope response under `--json`, treat that as a CLI machine-contract
regression. `service status --json` remains an unauthenticated local status read
so the GUI can show local service state before login.

## Scripts

- `pnpm run desktop:dev` — prepare and start the repo-local Desktop GUI lane
  (`openmeld-dev`, `~/.openmeld-dev`, local Gateway/Auth/Web).
- `pnpm run desktop:start:dev` — start the repo-local Desktop GUI lane without
  reinstalling the `openmeld-dev` wrapper.
- `pnpm run desktop:canary` — prepare and start the packaged-candidate Desktop
  GUI lane (`openmeld-canary`, `~/.openmeld-canary`, local Gateway/Auth/Web). This can run
  package release-readiness checks through `npm pack`.
- `pnpm run desktop:start:canary` — start the packaged-candidate Desktop GUI
  lane without reinstalling the `openmeld-canary` wrapper.
- `pnpm run desktop:start:prod` — start the production Desktop GUI lane
  (`openmeld`, `~/.openmeld`, `https://openmeld.ai`) for explicit production reproduction only.
- `pnpm -C clients/desktop dev` — start the Electron app in development mode
  without lane-specific CLI/Web/Auth configuration. Use this only for
  Electron-only work.
- `pnpm -C clients/desktop build` — build shared contract deps, then build main/preload/renderer with electron-vite.
- `pnpm -C clients/desktop start` — preview the built Electron app.
- `pnpm -C clients/desktop test` — build shared contract deps, then run unit/component tests (62: node L1/L2/L4 + jsdom L3).
- `pnpm -C clients/desktop typecheck` — build shared contract deps, then type-check.
- `pnpm -C clients/desktop check` — build shared contract deps, then run Ultracite + type-check.
