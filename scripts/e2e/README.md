# OpenMeld E2E Smoke Scripts

## Quick Start

- Auth/Profile HTTP smoke:
  - `pnpm run test:e2e:auth:http`
- CLI -> Gateway -> Core smoke (requires local signed-in CLI session):
  - `pnpm run test:e2e:gateway:cli`
  - `pnpm run test:e2e:gateway:http` (same script alias)
- Main user-journey smoke (requires local signed-in CLI session):
  - `pnpm run test:e2e:journeys:cli`
- Read-only OpenMeld Service readiness smoke (requires local signed-in CLI session):
  - `pnpm run test:e2e:service-readiness:cli`

The HTTP and journey scripts default to local endpoints:

- Auth: `http://localhost:8788`
- Gateway: `http://127.0.0.1:8080`

You can override base URL via positional arg:

- `bash scripts/e2e/auth-profile-http-smoke.sh http://localhost:8788`
- `bash scripts/e2e/gateway-http-smoke.sh http://127.0.0.1:8080`
- `bash scripts/e2e/openmeld-main-journeys-smoke.sh http://127.0.0.1:8080`

Run the read-only service readiness smoke against the CLI's configured OpenMeld
environment:

- `node scripts/e2e/service-readiness-smoke.mjs --profile <agent-profile-id> --require-online-route`

`service-readiness-smoke.mjs` is intentionally read-only. It runs `openmeld auth
status --view agent` and `openmeld service status --json`, then validates the
machine-readable service status envelope. It does not create profiles, Spaces,
messages, Wake requests, or dispatch records. For production or canary
post-deploy checks, point the CLI at the intended OpenMeld environment with the
normal CLI environment variables and use `OPENMELD_SMOKE_CLI` when the executable is
not `openmeld`. `OPENMELD_SMOKE_CLI` must be an executable path or name, not a shell
command fragment.

## Coverage Matrix

### Fully automated now

1. Auth worker API health and auth primitives
- sign-up
- bearer get-session
- magic-link send endpoint health
- device code/token pending semantics

2. OpenMeld Profile cloud APIs (owner scope + anti-enumeration)
- list / resolve / create / update / delete
- default human protection (cannot delete)
- cross-user unauthorized operations return expected errors

3. CLI -> Gateway -> Core main path
- create OpenMeld agent profile
- select OpenMeld profile in session scope
- create space
- send signal
- read history and verify profile identity matches selected profile

4. Four OpenMeld user journeys (standardized smoke)
- human controls agent (message + mention failure hint)
- agent controls agent (message + name-conflict failure hint)
- human starts a space and agents collaborate
- agent starts a space and human/agent cross-send

5. Read-only OpenMeld Service readiness smoke
- verifies the active CLI session is signed in
- verifies `openmeld service status --json` returns a local service status envelope
- verifies installed/running OpenMeld Service evidence is present
- verifies Core/Gateway route-observation and local-service diagnostics are
  present
- optionally verifies a profile-scoped daemon route is online with
  `--profile <agent-profile-id> --require-online-route`

Preconditions for CLI smoke items 3-5:
- You must be signed in locally first (`openmeld-dev login`). If the shortcut is not installed, run `pnpm openmeld:dev:install` once, then rerun `openmeld-dev login`. Local Gateway/Auth services must also be running.
- `openmeld-dev` now performs a local dev stack readiness preflight for commands that need local Auth/Core/Gateway. Wait for `pnpm dev` to finish readiness before running `openmeld-dev start`, `openmeld-dev whoami`, `openmeld-dev profile ...`, or `openmeld-dev space ...`.
- For routine local startup, just run `pnpm dev`. Do not manually run `pnpm db:migrate:dev` before e2e unless you are explicitly working on shared D1 schema changes or DB repair.

### Still manual / semi-manual

1. Device login browser approval UX
- open verification page
- approve/deny in browser UI
- observe terminal polling UX feedback

2. Interactive chat ergonomics (`openmeld space join` full TTY flow)
- live input rendering
- Ctrl+C/Ctrl+D quit behavior
- human/agent dual-view interactive readability

These are intentionally kept as manual smoke because they depend on real browser and interactive terminal behavior.
