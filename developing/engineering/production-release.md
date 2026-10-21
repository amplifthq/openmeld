# Production Release

## Agent Context

- Purpose: How an agent releases merged components to production.
- Read this when: You release Workers, the database, or the CLI.
- Update this when: `release/components.mjs`, `scripts/release/deploy*.mjs`,
  `deploy.yml`, `cli-release.yml`, or CLI publication changes.
- Do not use this for: Feature smoke steps or database ownership.
- Source of truth: `release/components.mjs` owns components, paths, order, and
  lanes; this file owns commands and guards; `agent-native-delivery.md` owns
  the merge and smoke lifecycle.

## Everyday commands

From a clean `main` checkout, use `pnpm run deploy`, not `pnpm deploy`:

```sh
pnpm run deploy -- --scope <auto|cloud|name[,name]> --lane <local|github|auto> [--sha <sha>] [--base <sha>] [--dry-run]
```

- `--scope auto` diffs each component from its live release SHA (or `--base`
  when unreadable) and selects it when a changed path matches its `paths`. Root
  build inputs such as `pnpm-lock.yaml` never widen the scope.
  If auto selects db without Core, the migration runs against the live Core.
  Use `--scope db,core` unless the migration is safe for the Core that is live
  now. Auto warns but does not add Core.
- `--lane github` dispatches cloud components through `deploy.yml` and CLI
  through the top-level `cli-release.yml`, following each run in dependency
  order. A failed cloud segment stops the later CLI dispatch. `--lane local`
  runs the same steps here with `openmeld-release/prd` credentials from Doppler
  (cheaper); `--lane auto` uses each component's `defaultLane`.
- `--dry-run` prints the plan and exact commands without deploying.

The local entrypoint must come from a clean checkout of current `origin/main`.
To release an older main commit, run that trusted entrypoint by absolute path
with the release-source checkout as the working directory. Both lanes load
release scripts from the control checkout. The component runner sets
`OPENMELD_RELEASE_SOURCE_ROOT` to its checked working directory, so migration
files, CLI sources, embedded Skills, and native build inputs come from the
requested product SHA. Do not set this variable by hand.

```sh
# A Website-only fix.
pnpm run deploy -- --scope website --lane github
# Core and Gateway on this workstation, to save Actions minutes.
pnpm run deploy -- --scope core,gateway --lane local
# Whatever the merge changed, on GitHub.
pnpm run deploy -- --scope auto --lane github --base <pre-merge-sha>
# Skill content: Web serves the signed bundle under clients/web/public/skills.
pnpm run deploy -- --scope web --lane github
# CLI or Service changes.
pnpm run deploy -- --scope cli --lane github
```

## What each component runs

`deploy-component.mjs <name> --sha <sha>` runs the component's steps from
`release/components.mjs` and refuses a dirty checkout or a SHA other than HEAD.

| Component | Deploy | Health |
| --- | --- | --- |
| db | `cutover.mjs migrate`, then `grant-runtime` | `cutover.mjs verify` |
| auth, gateway | build dependencies, then Wrangler with `--var RELEASE_SHA:<sha>` | `/health` reports the SHA |
| core | `deploy-core-worker.mjs`: bundle check, startup-admitted version upload, 100% activation | Cloudflare version carries the SHA |
| remote-agent | build dependencies and production bundle, then Wrangler with `--var RELEASE_SHA:<sha>` | Cloudflare version carries the SHA |
| web, website, docs | trusted local SSR artifact check, then `wrangler deploy` | `production-web-health.mjs` sees the SHA |
| cli | `publish-cli.mjs` | npm `gitHead` of the version is the SHA |

## Guards

- The SHA must be on `main`'s first-parent history; each top-level GitHub
  workflow's `validate` job checks it before building or publishing. Release
  control comes from `main` while product code comes from the SHA.
- `concurrency: production-<name>` with `queue: max` and
  `cancel-in-progress: false` keeps up to 100 pending jobs per component.
- A failed component stops its dependents. Website and docs in the same
  dispatch still run. The local lane stops at the first failure.
- Core refuses to deploy until the CLI release manifest exists in R2.
- The CLI is signed and notarized with the Apple identity; a changed CLI
  sub-component needs an explicit `available` or `required` decision.
- Run one release at a time. Never run local and GitHub lanes for the same
  component concurrently.

Local db/core releases use the workstation's Doppler and pscale logins.
GitHub uses `DOPPLER_TOKEN`, `PLANETSCALE_SERVICE_TOKEN_ID`, and
`PLANETSCALE_SERVICE_TOKEN`. Deploy steps also need Cloudflare credentials;
CLI publication needs Apple signing secrets.

## Recovery

Use these package filters from the repository root, except Core:

```sh
pnpm --filter @openmeld/auth-worker exec wrangler rollback --env prod
pnpm --filter @openmeld/gateway exec wrangler rollback --env prod
pnpm --filter openmeld-web exec wrangler rollback --env prod
pnpm --filter openmeld-website exec wrangler rollback --env prod
pnpm --filter openmeld-docs exec wrangler rollback --env prod
pnpm --filter @openmeld/remote-agent exec wrangler rollback --env prod
# Core: run from services/core with the previous production version ID.
pnpm exec wrangler versions deploy <previous-version-id>@100% --env prod
```

PostgreSQL migrations, npm versions, and the R2 release manifest are
forward-only. Check compatibility with the current data and published CLI
before a Worker rollback. Otherwise release a fixed SHA.

## Production Database Release

Migrations release as `--scope db`, usually with their consumer
(`--scope db,core`). `tooling/postgresql/cutover.mjs` confirms the PlanetScale
target, applies pending migrations, grants runtime access, and verifies the
journal. Migrations are immutable; a failure stops dependent components, and
Core's startup admission refuses a journal that is behind. Credentials and
ownership: [postgresql.md](postgresql.md). D1 is not a rollback target.

## CLI Release

CLI and Service releases require `--scope cli --lane github`. The Windows
process helper must be built on Windows before the macOS publish job signs
and notarizes the binaries. The local lane cannot perform this release.

The deploy command dispatches `cli-release.yml` directly on `main`, passing
the exact `release_sha`. This filename is the npm Trusted Publisher identity;
calling it as a reusable workflow from `deploy.yml` changes the OIDC caller
and can fail npm authentication. The CLI entry validates `main` and the source
SHA independently, retains the `production` environment and `id-token: write`
permission, and runs the existing signing, publication, and installation checks.
Downstream jobs consume the SHA returned by that verifier, rather than the raw
dispatch input. Invalid or non-mainline source values produce no release output.
CLI execution jobs checkout only the immutable main control revision. Its
`prepare-release-source.mjs` revalidates the product SHA against that control's
first-parent history and creates a detached `release-source` worktree before
any product installation or execution. It refuses an existing source path.
`deploy.yml` rejects CLI scopes so it cannot report a skipped CLI release as
successful. Use the unified deploy command for mixed cloud/CLI releases.

A pull request that changes the CLI, Service, or Skills bumps
`clients/openmeld-cli/package.json` and records one decision per changed
component in `release/local-components-policy.json`:

```json
{ "version": "0.3.265", "cli": { "updatePolicy": "available", "reason": "…" } }
```

`required` needs `openmeld.minRequiredCliVersion` (CLI) or
`MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION` (Service) at that version; a
contract change must be `required`. `pnpm run verify:release-ready` checks it.

`scripts/release/publish-cli.mjs` then, from one SHA:

1. builds the CLI (with this run's Windows helper) and hashes Service, Skills;
2. compares them with the published `cli/local-components.json` and refuses a
   changed component without a decision; unchanged Service and Skills keep their
   published entries, including the exact Service version;
3. uploads the signed binary channel, publishes the verified npm tarball, waits
   up to two minutes for npm, and tags `v<version>`;
4. writes the release manifest to `cli/local-components.json` in the CLI release
   bucket. Core reads it at runtime within one minute; no Core deploy is needed.

### npm submission and availability

Every stage checks the platform first, so a rerun resumes; a version on npm
from another commit is refused. `cli-release.yml` also checks clean npm
installs on Ubuntu and Windows (Node 24) and the Node 20 rejection.

The repository no longer commits the manifest. Each publication writes it to
`cli/local-components.json` and to an immutable per-version copy at
`cli/releases/<version>/local-components.json` in the same bucket. If the
current key is ever lost or corrupted, restore it from the latest version copy
before deploying Core:

```sh
pnpm exec wrangler r2 object get openmeld-desktop-downloads-prod/cli/releases/<version>/local-components.json --remote --file manifest.json
pnpm run release:cli:seed-manifest --from manifest.json
```

## Desktop, Windows preview, and OpenConnector
Desktop follows [its own procedure](development-workflow.md#desktop-preview-release-workflow);
`node scripts/release/desktop-preview.mjs status` reads its promoted pointers.

A Desktop Main or packaging change must reach each affected platform's promoted
release; a Web, shared-package, or build-script change needs a Desktop impact
review. The Windows internal preview reads CLI and Service decisions from
`release/local-components-policy.json`. OpenConnector keeps
`deploy:openconnector:*`.

## Release report

Report the SHA, components and lane, the run or local output, each health
result, the real-user smoke result, and anything not run with its reason.
