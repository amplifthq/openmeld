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

From a clean checkout of a `main` commit, `pnpm run deploy` (not pnpm's own
`pnpm deploy`) selects, orders, and runs components:

```sh
pnpm run deploy -- --scope <auto|cloud|name[,name]> --lane <local|github|auto> [--sha <sha>] [--base <sha>] [--dry-run]
```

- `--scope auto` diffs each component from its live release SHA (or `--base`
  when unreadable) and selects it when a changed path matches its `paths`. Root
  build inputs such as `pnpm-lock.yaml` never widen the scope.
  If auto selects db without Core, the migration runs against the live Core.
  Use `--scope db,core` unless the migration is safe for the Core that is live
  now. Auto warns but does not add Core.
- `--lane github` makes one `deploy.yml` dispatch and follows it; `--lane local`
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
# Typical releases.
# A Website-only fix.
pnpm run deploy -- --scope website --lane github
# Core and Gateway on this workstation, to save Actions minutes.
pnpm run deploy -- --scope core,gateway --lane local
# Whatever the merge changed, on GitHub (the fastest path).
pnpm run deploy -- --scope auto --lane github --base <pre-merge-sha>
```

Order comes only from `dependsOn` (db, auth, core, gateway and remote-agent,
web; website and docs are independent); any other order takes two runs.

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

The platform is the release record: Worker `RELEASE_SHA`, the renderer
`openmeld-source-sha` meta tag, and npm `gitHead`.

## Guards

- The SHA must be on `main`'s first-parent history; in GitHub only `validate`
  checks it, and release control comes from `main` while product code comes
  from the SHA.
- `concurrency: production-<name>` with `cancel-in-progress: false` runs one
  production job per component and never cancels one.
- A failed health check stops the run; later components do not start.
- Core refuses to deploy until the CLI release manifest exists in R2.
- The CLI is signed and notarized with the Apple identity; a changed CLI
  sub-component needs an explicit `available` or `required` decision.
- Recovery for a bad Worker version is `wrangler rollback` to the previous
  version, or a forward release of a fixed SHA.

GitHub db and core jobs need `DOPPLER_TOKEN`, `PLANETSCALE_SERVICE_TOKEN_ID`,
and `PLANETSCALE_SERVICE_TOKEN` and name any that is missing; all jobs need the
Cloudflare secrets, and the CLI also needs the Apple signing secrets.

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

Every stage checks the platform first, so a rerun resumes; a version on npm
from another commit is refused. `cli-release.yml` also checks clean npm
installs on Ubuntu and Windows (Node 24) and the Node 20 rejection.

Seed the manifest once, before the first Core that reads it is deployed:

```sh
pnpm run release:cli:seed-manifest --from release/local-components.json
```

### npm submission and availability

The tarball is packed with pnpm, checked for workspace dependencies, and
installed with plain npm before publication. The publisher then waits for the
exact version and `gitHead`, and fails without republishing when npm is late.

## Desktop, Windows preview, and OpenConnector

Desktop follows [its own procedure](development-workflow.md#desktop-preview-release-workflow);
`node scripts/release/desktop-preview.mjs status` reads its promoted pointers.

### Desktop release coverage

A Desktop Main or packaging change must reach each affected platform's promoted
release; a Web, shared-package, or build-script change needs a Desktop impact
review. The Windows internal preview reads CLI and Service decisions from
`release/local-components-policy.json`. OpenConnector keeps
`deploy:openconnector:*`.

## Website/App origin migration

Website serves the root domain and Web serves `app.openmeld.ai`. Only staging
keeps domain-phase tooling (`pnpm staging:deploy -- --domain-phase`).

## Release report

Report the SHA, components and lane, the run or local output, each health
result, the real-user smoke result, and anything not run with its reason.
