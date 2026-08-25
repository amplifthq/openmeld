# Production Release

## Agent Context

- Purpose: Define how to choose, run, verify, and report OpenMeld production
  releases without turning every change into a fleet rollout.
- Read this when: You are planning or executing a local production deploy, a
  GitHub production deploy, a production D1 migration, or a CLI publish.
- Update this when: Release scopes, workflow inputs, production ordering,
  database gates, CLI publication, health checks, or release evidence changes.
- Do not use this for: Feature-specific smoke steps, local development lanes,
  database ownership, or CLI binary implementation details.
- Source of truth: This file owns production release lane selection, scoped
  release entrypoints, database release ordering, and operator evidence.

## The Default Rule

Release only what changed.

- A Web fix releases Web.
- A Gateway fix releases Gateway.
- A database migration plus Core change releases Database, then Core.
- A CLI patch publishes CLI and updates its required Core projection.
- Any change to a file that feeds the packaged CLI or OpenMeld Service bundle,
  including embedded data such as `release/vendor-models.json`, is a
  local-component release even when no runtime behavior changes: stamp from a
  clean `main` worktree and publish through the CLI lane. A Core-only deploy
  fails closed on the stale bundle hash.
- `cloud` and `full` are explicit coordinated rollouts, not defaults.

Do not redeploy unrelated services for ceremony. Broader validation may be
appropriate for a cross-service contract change, but broader validation does
not require a broader production rollout.

## Choose The Release Lane

| Current situation                                                                                                                           | Use                                                                                 | Why                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A dedicated release worktree is clean at the exact approved `main` commit, and local production credentials are ready                       | Local scoped release                                                                | It is the shortest path and deploys directly from the approved immutable commit without occupying the human workspace. |
| Other agents have dirty work, work is arriving from multiple machines, or the local workspace cannot become clean without interrupting work | GitHub scoped release                                                               | GitHub checks out one immutable commit and does not consume the shared local workspace.                               |
| Publishing a normal CLI release with Apple signing and notarization                                                                         | GitHub CLI release by default                                                       | The macOS runner and production Environment own the complete signing, notarization, R2, npm OIDC, tag, and Core path. |
| Recovering a partially completed CLI release                                                                                                | GitHub CLI release with the exact original `release_sha` and matching recovery path | Every resumed stage stays anchored to the commit that created the immutable artifact.                                 |

Do not use the primary `main` checkout as an agent release lane. Do not use a
local production release from a dirty worktree, or stash or delete another
agent's work to manufacture a clean release window. Prepare a dedicated release
worktree at the approved `main` commit, or commit and push the intended release
commit and use GitHub instead.

## Read Remote Release Status

Before choosing a GitHub release scope, compare an immutable remote ref with
the latest successful component jobs recorded by GitHub Actions:

```sh
git fetch origin main --tags
pnpm run release:status -- --ref origin/main
```

This command is read-only. It reads Git history plus GitHub workflow, job, and
checkout-log results, reports the production components whose deployed commits are behind
the selected ref, and fails closed while push checks for that ref are red or
still running. It does not dispatch a workflow, deploy a component, or edit a
release file. Its `Deployment state` describes deployment history, not permission
to release. `Source validation` reports exact-SHA push evidence when present and
otherwise tells the operator to confirm `Fast PR` or equivalent evidence. Use
`--json` for automation.

The resolved source SHA is the cutoff for that release. Commits that reach
`main` after the cutoff belong to the next release; do not restart or widen an
already-running release merely to chase a newer `main`.

GitHub cannot discover a deployment performed only from a workstation. When a
guarded local release is newer than the latest successful GitHub job, provide
that known source explicitly instead of inventing another state ledger:

```sh
pnpm run release:status -- --ref origin/main \
  --deployed web=<exact-deployed-commit>
```

Repeat `--deployed` for multiple local releases. The command accepts an
override only when that commit is an ancestor of the selected ref.

## Release Scopes

The local release tool accepts these direct scopes:

```text
db
web
gateway
auth
core
remote-agent
cli
```

It also accepts comma-separated scopes, `cloud`, and `full`.

- `cloud` means Auth, Web, Gateway, Core, then Remote Agent.
- `full` means Database followed by `cloud`.
- `full` never publishes CLI. CLI is immutable publication and must always be
  selected explicitly.
- Selecting `cli` owns its required Core projection; adding `core` does not
  deploy Core twice.

`auto` is the default local plan. It follows changed workspace dependencies and
local-component release paths, so it intentionally prefers a safe superset for
shared package changes. Review the plan. An operator may narrow it with an
explicit scope only when the changed contract and mixed-version behavior prove
that narrower rollout is safe.

The planner selects the `remote-agent-receiver-first` deploy-order profile when
the diff contains one of these explicit Core-to-Remote-Agent receiver owners:

- `services/remote-agent/.flue/cloudflare.ts`
- `services/remote-agent/flue-adapter/cloudflare-entrypoint.ts`
- `services/remote-agent/flue-adapter/execution-reconciliation.ts`

It selects the same profile when a diff expands a strict Remote Agent request
shape—either with a new request version or an additive field—and changes its
explicit shared-schema request owner, Core producer/admission owner, and Remote
Agent Center Agent receiver together. Those three signals distinguish a
directional request-envelope rollout from a non-directional shared-schema edit.

Within the selected scopes it deploys Database, Remote Agent, Auth, Core,
Gateway, Web, then CLI. This installs strict Remote Agent RPC receivers before
Core callers and keeps a selected CLI unpublished until every cloud receiver is
ready. Shared schemas and Core's native-delivery service are intentionally not
directional path signals because they carry contracts in both directions.

The strict version-4 Center Agent conversation contract is such a request-side
change. Apply its D1 generation-pointer migration first, deploy Remote Agent so
it accepts version 4, and deploy Core last so it begins producing version 4.
This request-receiver-first requirement takes precedence if the same diff also
changes the strict worker response union; otherwise Core could deploy first and
send an envelope that the active Remote Agent rejects before execution.

The planner selects the `core-worker-response-reader-first` profile when the
strict Remote Agent worker-response schema and its Remote Agent producer change
in the same diff. Within the selected scopes it deploys Database, Auth, Core,
Remote Agent, Gateway, Web, then CLI. Core must accept the expanded strict
response union before Remote Agent can emit it; otherwise an old Core treats a
valid new rejection as a protocol error. The schema path alone remains
non-directional, so request-only changes do not accidentally select this
profile. This response-reader requirement takes precedence when the same diff
also contains Center Agent Task or Context Manifest paths.

The planner selects the `center-agent-cli-receiver-first` profile when the diff
contains a Center Agent Task or Context Manifest contract path. Within the
selected scopes it deploys Database, Remote Agent, Auth, Core, Gateway, Web, and
finally CLI. Remote Agent comes before Core because an old strict Remote Agent
rejects the Context Scope Plan fields emitted by new Core. Every old caller
continues working while each additive receiver comes online, and only the final
CLI publication can expose the new command.

When any receiver-first profile includes both Core and CLI, the first Core
deploy reads the stable production CLI version, loads that version's
`release/local-components.json` from its immutable `v<version>` Git tag, and
compiles that already-published projection into the new Core receiver. It fails
closed if the channel, tag, or versions disagree. After all receivers are
healthy, the ordinary guarded CLI release publishes the new R2/npm artifacts
and redeploys Core with the checked-in projection. This two-phase Core deploy
prevents both unsafe states: publishing a new CLI before its receivers and
announcing a CLI version before its artifact exists. The temporary projection
is a build-time override, not a second runtime variable or mutable release
ledger.

The planner selects `local-service-runtime-receiver-first` when one diff changes
the strict Runtime Transport schema, a Core Runtime Transport receiver, and a
local OpenMeld Service producer together. Within the selected scopes it deploys
Database, Auth, Web, Gateway, Core, Remote Agent, and finally CLI. When Core and
CLI are both selected, Core first deploys with the current published CLI
projection; only after that receiver is healthy may the signed CLI/Service
release advertise or emit the new strict capability. An explicit scope that
publishes CLI without Core fails closed. This profile is structural and
provider-neutral: it protects any strict Service-to-Core protocol addition
without coupling release order to one Agent Controller or business workflow.

The ordinary `cloud` order installs Auth receivers before Web, then continues
through Gateway, Core, and Remote Agent. A Web-only release still skips Auth;
the dependency only orders coordinated releases. Contracts that require a
different consumer-first direction must keep using their explicit staged scope
or receiver-first profile instead of weakening this default dependency.
The planner reports this ordinary order as `default-auth-receiver-first`, which
names its mixed-version invariant instead of implying that every boundary in
the cloud graph is consumer-first.

### Inbox source-target receiver-first order

The planner selects `inbox-source-target-receiver-first` when a diff changes the
strict Inbox source-target schema together with a Core writer for those targets.
The writer inventory includes Message Channel terminal-delivery projection and
RuntimeCoordinator Agent Interaction projection. It automatically includes Web,
Gateway, and Core, and rejects a manually narrowed scope that omits any of those
components. Within the selected scopes, Web deploys and passes health first,
Gateway deploys and passes health next, and Core deploys last. When the Message
Channel repair migration is selected, Database migration `0128_massive_blur`
applies before those receivers. Its nullable last-attempt field does not start
new writes under old Core. If the shared schema also selects a local-component
release, the existing receiver-first CLI mechanism keeps immutable CLI
publication last and uses the current production CLI projection for the first
Core deploy.

If the same release also changes a strict Remote Agent request receiver, the
planner composes both constraints as
`remote-agent-and-inbox-receivers-first`: Remote Agent, Web, and Gateway all
deploy and pass health before Core, and an explicit scope that omits Remote
Agent fails closed. If it instead changes a strict Remote Agent response
producer, the Inbox profile already places Web and Gateway before Core and Core
before Remote Agent. A compound release never silently discards one
receiver-first dependency in favor of another profile name.

The strict persisted-row readers are Core's D1-to-Inbox mapper and RPC response,
Gateway's response boundary, and the Web API client. Core is also the only
writer. The receiver-first window is therefore safe in both directions: the new
Web and Gateway continue accepting old Core responses, then the new Core writes
rows that every deployed reader accepts. Source-target version `4` receives the
current thread-aware Agent Interaction target. Version `3` receives the same
target without its thread locator, and missing or older headers receive the
legacy target projection. Gateway applies those projections after validating
Core's complete response for list, direct-item, and read-mutation operations, so
items, counts, and cursors stay aligned. SQL-only Inbox filters and urgent-email
delivery do not deserialize `source_target_json`; Remote Agent and CLI do not
read these rows and are not additional runtime receiver stages. CLI remains a
release scope when the shared schema changes because that package feeds the
immutable OpenMeld Service bundle. After Core is active, Message Channel repair
upgrades pre-release Slack targets in place while preserving item id, read time,
action resolution, and dismissal. RuntimeCoordinator repair records preserve an
absent legacy thread locator rather than manufacturing main-timeline identity.

Rollback is forward-only at the reader boundary. First stop new writes with a
Core change that retains the new schema. Keep the compatible Core, Gateway, and
Web readers deployed because already-written rows remain durable. Do not deploy
an old reader, manually rewrite D1, or delete Inbox rows as a rollback shortcut.
A full reader rollback is permitted only after an explicit migration or
retention process verifies that no persisted `message_channel` target remains.
The additive nullable migration remains applied during rollback.

### Organization Skills first-launch order

The first Organization Skills release is a consumer-first exception to the
ordinary `cloud` component order. The new Core producer includes the optional
Organization Skill release selection in strict Remote Agent turn envelopes; an
old Remote Agent rejects that envelope instead of ignoring the field. The new
Remote Agent can also emit Organization Skill work-activity keys that an old
Web stream reader does not accept.

From the same approved immutable SHA:

1. deploy `web` alone so it accepts the new work-activity keys;
2. deploy `remote-agent` alone and verify its active production version;
3. run the normal `full` release so D1 migrations apply before Web, Gateway,
   Auth, Core, and the idempotent final Remote Agent deploy;
4. publish `cli` only after the new Core Organization Skills API is active; and
5. run the authenticated Web, Center Agent, runtime activation, and published
   CLI smoke from `developing/product/organization-skills.md`.

Do not allow Core to emit Organization Skill selections before step 2 completes.
Rollback reverses the strict contract boundary: restore the previous Core
producer first so it stops emitting the field, then restore the previous Remote
Agent, and only then restore the previous Web. The additive D1 tables and
immutable R2 release objects remain in place while Web and CLI compatibility is
assessed; do not delete them as a rollback shortcut.

### CLI compressed and delta transport first-launch order

The first compressed CLI release is a consumer-first Web rollout. The existing
production manifest route validates and reserializes R2 metadata, so an older
Web deployment removes archive fields it does not know. From the same approved
immutable SHA:

1. deploy `web` first; with the old manifest it continues serving and
   downloading the verified raw executable;
2. publish `cli` with the binary channel so R2 receives the raw executable,
   gzip archive, and any exact-base delta before the manifest advertises them;
   and
3. verify the public manifest exposes the complete archive and delta records,
   then run the published setup and upgrade smokes.

After this first rollout, ordinary CLI-only releases may use the normal CLI
lane. Old CLI clients ignore the additive archive fields and keep using the raw
URL. Rolling Web back temporarily removes the archive projection and returns
all clients to the verified raw fallback; it does not make setup or upgrades
unsafe. Old clients also ignore additive delta and signing-identity fields.

## Local Scoped Release

Use this lane only from a dedicated clean release worktree at the exact approved
`main` commit being released. The primary `main` checkout remains the human
workspace and is not an agent release lane.

```sh
git status --short
git fetch origin main --tags
pnpm run release:plan
pnpm run release:deploy:local -- --scope web
```

`git status --short` must print nothing. The deploy command records the source
SHA, runs the cheap deployment preflight, checks that the worktree and SHA stay
unchanged, deploys in safe order, and runs the selected component health check
before moving on. It does not repeat package checks, unit tests, or integration
tests that already established confidence in the commit.

Use the verify-only command when you need a complete scoped go/no-go result or
handoff before deployment. The later deploy intentionally does not repeat it:

```sh
pnpm run release:verify:local -- --scope gateway
```

Use the preflight-only command to inspect the exact deployment invariants
without deploying:

```sh
pnpm run release:preflight:local -- --scope core
```

Every preflight checks the cheap repository release contracts. Core additionally
fails closed unless the production CLI channel can satisfy the local-component
version it will project. The CLI publisher still owns the mandatory final
release-readiness gate before irreversible publication; an earlier aggregate
`release:preflight` result is diagnostic evidence and does not discharge that
gate. Database generation, migration truth, remote application, physical
verification, and optimization remain owned by `db:release:prod` itself.

Useful examples:

```sh
# Let the tool infer scopes from commits not yet on origin/main.
pnpm run release:deploy:local

# Release a known Web-only fix after the commit is already on origin/main.
pnpm run release:deploy:local -- --scope web

# Apply a Core-owned migration and then release only Core.
pnpm run release:deploy:local -- --scope db,core

# Run the coordinated Auth-first cloud scope through the same guarded planner.
pnpm run deploy:cloud
```

`pnpm deploy` is a short alias for the automatic local scoped release. Prefer
the longer command in deployment reports because it makes the lane explicit.
`pnpm run deploy:cloud` is the guarded alias for `--scope cloud`; it must not
expand into raw per-component deploy scripts. The former `deploy:cloud:*` raw
aliases are retired because they bypassed source validation, preflight, ordered
health checks, and the planner's mixed-version contract.

## Core Worker Startup Admission

Cloudflare requires a Worker to parse and run its global scope within one
second. A Worker that crosses that fixed limit is rejected with error `10021`
before it can receive traffic. Raising `limits.cpu_ms` does not change this
startup limit; that setting applies to request CPU after startup.

Every supported Core release path must therefore use the guarded Core deploy
entrypoint. This includes the GitHub Core workflow, a local scoped Core release,
the temporary current-CLI projection used by receiver-first releases, and the
final Core projection in a CLI release. The guard performs these steps in
order:

1. Build Core's workspace dependencies from the exact checked-out release SHA.
2. Upload the production Core source and compile-time definitions as a new
   Cloudflare Worker Version with zero production traffic.
3. Read Cloudflare's actual `Worker Startup Time` and the structured
   `version-upload` result. Missing or malformed evidence fails closed.
4. Continue only when Cloudflare reports at most `500 ms`. This OpenMeld limit
   deliberately keeps 50 percent headroom below Cloudflare's hard limit.
5. Run the ordinary production deploy only after admission passes. The
   ordinary deploy remains responsible for applying the tracked routes,
   triggers, bindings, migrations, and other production configuration.

The zero-traffic upload and the ordinary deploy use the same immutable source,
production environment, minification, and compile-time definitions. They are
two builds because routing the uploaded version directly would not by itself
prove that every non-versioned production setting was applied. Do not replace
the ordinary deploy with an exact-version traffic change until configuration
parity has a separate reviewed and tested contract.

`pnpm run evidence:startup:core` captures a local CPU profile and summarizes
active, garbage-collection, and idle time. Use it to locate expensive global
initialization and compare two revisions on the same machine. It is diagnostic
evidence only: Cloudflare hardware differs, and the local number must never be
used as a substitute for the zero-traffic Cloudflare admission result.

The workflow preserves these files for diagnosis:

```text
dev-tmp/core-bundle-evidence.json
dev-tmp/core-startup-evidence.json
dev-tmp/core-startup-admission.json
dev-tmp/core-startup.cpuprofile
```

If admission rejects a version, or the later deploy still reports `10021`, do
not retry the unchanged source hoping for a faster Cloudflare machine. Do not
raise the `500 ms` OpenMeld limit and do not raise request CPU limits as a
workaround. Keep the current production version active, use the bundle and CPU
profile evidence to remove eager global initialization, and rerun admission
only after a reviewed source change. Cloudflare's current startup and version
upload contracts are documented in [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/).

## GitHub Scoped Release

Use `.github/workflows/release-on-main.yml` (`Scoped Production Release`) for
Worker and database releases from an immutable `main` commit.

Available scopes are:

```text
database
database-auth
database-core
web
gateway
auth
core
remote-agent
cloud
full
```

- The default is `web`, not `full`.
- `database-auth` and `database-core` are the normal migration bundles. They
  keep the database and its owning Worker in one ordered workflow without
  redeploying the fleet.
- `cloud` deploys only the five cloud components.
- `full` runs Database, Auth, Web, Gateway, Core, and Remote Agent in order.
- CLI publishing is not available in this workflow.

For a Center Agent bridge release that includes Context Scope Plan, first run
the `remote-agent` scope from the approved commit and verify it succeeds. Then
run the remaining required database/cloud scopes, and publish CLI only after
those receivers are healthy. The ordinary `cloud` and `full` DAGs retain their
default order because other contracts require Core receivers before Remote
Agent callers; the early standalone Remote Agent release is the explicit
receiver-first stage for this mixed-direction contract.

`preview` only resolves and reports the selected scope. It is useful for a new
or coordinated rollout, but an obvious single-component release may run
`deploy` directly. Every dispatch requires the exact 40-character `main`
commit approved for the release. The workflow validates that immutable
`release_sha` against the first-parent history of `main` and uses it for every
selected component. A merged pull request's side-branch head is an ancestor of
`main`, but it is not an approved `main` release source and is rejected. Later
commits merged into `main` belong to a later release. `--ref main` selects the
trusted workflow definition, while `release_sha` selects the code being
released. Deploy mode is restricted to `main`.

For example, capture the approved commit once and use that exact value for a
Web release even if `main` advances afterward:

```bash
release_sha="$(git rev-parse origin/main)"
gh workflow run release-on-main.yml \
  --ref main \
  --field mode=deploy \
  --field scope=web \
  --field release_sha="$release_sha"
```

When `release:status` reports that the captured commit is ready, confirm its
`Fast PR` or equivalent scoped validation evidence and dispatch the selected
release with that exact SHA. One small source-validation job verifies the SHA
shape and its membership in the first-parent history of `main` before any
selected production job can enter its Environment. A non-`main` deploy runs one
rejection job and never enters the production component jobs or Environment.

Each component workflow checks out the captured release SHA, installs through
the cached pnpm setup, runs only the cheap deployment preflight, deploys once,
and performs a lightweight health check. It does not rerun package checks, unit
tests, or integration tests. Per-component concurrency locks serialize two
releases of the same component without blocking unrelated components. Database
and CLI publication retain their own production locks.

## Production Database Release

Production database work has one implementation entrypoint:

```sh
pnpm run db:release:prod
```

`pnpm db:sync:prod` is an alias to the same command. Do not maintain another
sequence in a workflow or service package.

The command requires a clean worktree and runs exactly this sequence:

1. build the Auth code-generation dependency;
2. run `db:generate` against the local tooling target;
3. stop before production if generation changes any tracked or untracked file;
4. run `db:check` against the local tooling target so a resumable skip never bypasses committed schema and migration truth;
5. read the remote pending list and apply production migrations through Wrangler `--remote` only when entries remain;
6. verify the production physical database contract;
7. run plain `PRAGMA optimize` once after synchronization.

Local release operators may authenticate Wrangler with its supported OAuth
login. Automated release lanes provide `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` instead. The release preflight verifies the active
Wrangler authentication and then proves access to the configured production D1
target with the read-only remote migration list. It does not require local
schema generation or `db:check` to use production Drizzle HTTP credentials.

Database release is selected only when committed schema or migration truth
changed, or when an operator explicitly requests database repair. A normal Web,
Gateway, Auth, Core, or Remote Agent release does not run migrations and does
not run `PRAGMA optimize`.

Plain `PRAGMA optimize` is intentional. Cloudflare D1 supports it as the safe
post-schema synchronization operation, and it may be a no-op when statistics
are already current. Do not add a scheduled optimize job, run it after every
Worker deploy, replace it with a long manual `ANALYZE`, or use unsupported
SQLite-only flag variants. D1 Time Travel is automatic; do not add a routine
full export before every release.

Never rewrite an applied migration. A failed production migration stops the
release. Preserve its output, inspect the D1 migration ledger and Time Travel
state, and decide recovery explicitly instead of continuing to Workers.

## CLI Release

CLI publication is a separate immutable release, not another Worker scope.
Read `developing/engineering/cli-binary-release.md` for artifact and Apple
credential details.

Before publication, run `pnpm run release:preflight`, then let the base-aware
stamp command select the next immutable patch from npm `latest` and the R2
stable manifest while choosing the real policy:

```sh
pnpm release:local-components stamp --next \
  --cli available --service available --skills available
```

The command prints both channel versions, the higher version, and the selected
patch. Channel drift is a warning and still selects the higher patch plus one.
If either channel cannot be read, `--next` fails without changing or guessing a
version. Use `--version X.Y.Z` instead only when an operator has already
approved that exact version; `--version` and `--next` are mutually exclusive.

- `available` advertises the patch without blocking existing Wake work;
- `required` is reserved for an incompatible contract or a concrete unsafe old
  version.

The stamp command rebuilds the packaged CLI before recording its Service hash,
rejects source drift, and verifies the result. Never hand-edit the hash, reuse
an existing `dist`, or pass `--current` to prepare a release manifest. Rerun the
stamp after any merge, rebase, or later local-component change. Stamp commits
land only on `main`, pushed directly from a clean `main` worktree; feature and
PR branches must keep the base package version and manifest unchanged, which
the pre-push gate enforces through deferred-release verification against the
PR base.

At publication time, `pnpm run release:cli --next --with-binary` rechecks the
same npm/R2 decision and requires it to match the committed package and manifest;
it never edits the clean release worktree. Use the canonical command without a
version selector when resuming a partially completed immutable release, because
the resumable executor already reads its target from the committed package.

For GitHub, use `.github/workflows/cli-release.yml`:

1. for a normal CLI publication, run `release_path=normal` directly;
2. the workflow runs the `release_ready` gate before publication;
3. use `release:verify:local -- --scope cli` for an earlier complete go/no-go
   decision or handoff;
4. use `Scoped Production Release` separately when the release card also
   requires database or cloud fleet changes.

The workflow publishes the signed and notarized binary, R2 manifest, npm
package, tag, and Core projection. It does not migrate the database or redeploy
Auth, Remote Agent, Gateway, or Web.

For an approved local release with the required Keychain, npm, and Cloudflare
credentials:

```sh
pnpm run release:deploy:local -- --scope cli
```

Both lanes fail closed before artifact upload when signing, signature
verification, or Apple notarization fails. Never publish an unsigned or
unnotarized production macOS binary.

Recovery inputs remain available for workflow compatibility, but they all run
the same resumable release command at the exact original `release_sha`:

- `normal`, `resume-after-binary-upload`, and `resume-after-npm-publish` all
  invoke `pnpm run release:cli --with-binary`.
- The executor probes each immutable stage and skips completed work instead of
  relying on a human-authored exclusion list.
- Always provide the original `release_sha`; a release tag or Core projection
  from another commit is a hard failure, not a recovery target.

When R2, npm, and the immutable release tag are already complete but the Core
projection alone failed Cloudflare startup validation, do not rerun the CLI
publisher. Merge the reviewed Core startup fix first, then dispatch
`.github/workflows/recover-core-cli-projection.yml` from `main` with that exact
new main commit:

```sh
gh workflow run recover-core-cli-projection.yml \
  --ref main \
  --field release_sha="<exact-reviewed-main-commit>"
```

This Core-only recovery reads `channels.stable.version`, loads that version's
`release/local-components.json` and commit identity from its immutable Git tag,
derives the expected Core Worker tag from those exact bytes, and injects both
the tagged manifest and Worker tag into the new Core build. It then verifies
deployment visibility and performs the read-only R2/npm/Core alignment probe.
It never moves the release tag, republishes npm or R2, or deploys Auth, Web,
Gateway, or Remote Agent. The GitHub CLI release and this recovery share the
Core deployment lock so those GitHub lanes cannot change the stable channel
while recovery is building or deploying its projection.

## Resumable Execution

The guarded local executor is safe to rerun after interruption. Completion
probes are read-only. A completed stage prints `SKIP (already done)` with its
criterion; an incomplete stage prints `RUN` and executes the existing command
and gates unchanged. If a completion probe cannot run because of network,
credentials, or malformed output, the executor prints the probe failure and
runs the stage. It never skips work on uncertain evidence.

The built-in production order is:

```text
production D1 -> CLI/Service channel -> scoped Worker verify/deploy -> R2/npm/Core alignment
```

The CLI release creates its required Core projection before other selected
Workers. After every selected Worker deploy and health check, the production
executor reruns the same resumable CLI command as the terminal three-way
alignment check; when the release is complete, that rerun is read-only and all
stages skip. Before each Worker deploy, the executor prints the current
production version ID for comparison. Repeated Worker deploys remain allowed
because they are safe, even though they create another Worker version.

| Stage | `SKIP` criterion | Criterion level |
| --- | --- | --- |
| Production D1 migration application | `wrangler d1 migrations list --remote` reports no pending migrations | Remote pending-list truth |
| CLI binary, signing, notarization, and R2 | The production manifest has the target version; the platform record has a valid sha256 and positive size; `HEAD` confirms the artifact is downloadable with that size | Published-record evidence; no local rebuild/hash comparison |
| npm | `npm view` reports the target immutable version | Registry version existence |
| Release tag | The target tag resolves to the current release commit both locally and on `origin` | Local and remote Git object identity |
| Core projection | The active 100% production Worker version carries the stable tag derived from the release commit and `release/local-components.json` | Active Worker version identity |
| Final channel alignment | R2, npm, and the active Core projection all satisfy their target criteria | Three-way published state |

A release tag that exists at another commit locally or on `origin` fails
immediately and is never moved. The resumable executor owns both local tag
creation and exact-ref publication to `origin`; callers must not add a second
tag-push path. A final channel-alignment failure includes the exact next release
command. The normal recovery command is therefore the original command, not a
manually shortened sequence:

```sh
pnpm run release:deploy:local -- --scope cli
```

## OpenConnector Release

OpenConnector is an external source checkout with an OpenMeld-owned production
configuration. Its tracked deployment source is
`config/openconnector/wrangler.production.jsonc`; do not deploy production from
an ignored `wrangler.local.jsonc`.

OpenMeld maintains the public downstream fork
`https://github.com/amplifthq/open-connector`, whose `main` must remain a clean
mirror of `https://github.com/oomol-lab/open-connector` `main`. Put each general
fix on its own fork branch and submit it upstream. Keep a downstream-only patch
outside fork `main`, on an explicit OpenMeld release branch, only when
production needs it before upstream merges or when the behavior is genuinely
OpenMeld-specific.

For a newly prepared local checkout, use `origin` for the Amplift fork and
`upstream` for the official repository. Existing concurrent checkouts may use
different remote names; identify remotes by URL before fetching or pushing, and
do not rename remotes or rewrite branches merely to normalize an active
worktree. Fork creation, remote changes, branch pushes, and fork synchronization
do not change the running Worker. Only the explicit deployment command below
changes production.

Deploy only a clean checkout at an explicitly reviewed full commit SHA:

```sh
pnpm deploy:openconnector:production -- \
  --source /absolute/path/to/open-connector \
  --source-sha <full-commit-sha>
```

The reviewed source SHA must exist in the Amplift fork so another operator can
reproduce, roll back, or redeploy it without relying on one workstation. After
an upstream patch merges, synchronize fork `main`, remove the superseded
downstream patch from the next OpenMeld release branch, and validate that exact
remote SHA before deployment. Synchronizing the fork alone never requires a
production redeploy.

The command regenerates the provider catalog, builds and copies the Web assets,
applies pending remote D1 migrations, and deploys the Worker with the tracked
policy while preserving Cloudflare secrets. When every canonical secret is
available in the release environment, the command sends the complete set to
Wrangler over stdin. Otherwise it fails closed unless the existing production
Worker already exposes every required secret name, then deploys without
replacing those secret values. Never rotate the credential-encryption key or a
provider credential merely to perform an ordinary source release. After
deployment, prove the admin and runtime token surfaces independently and prove
that each token receives `401` from the other surface. These internal checks
are deployment evidence; one user-visible Center Agent result is still required
as the real-user smoke.

## Health Checks And Product Smoke

Release automation performs only cheap component health checks:

| Component    | Automated post-deploy evidence                                                    |
| ------------ | --------------------------------------------------------------------------------- |
| Web          | `https://openmeld.ai/guide.md` responds successfully                              |
| Gateway      | `https://gateway.openmeld.ai/health` responds successfully                        |
| Auth         | `https://auth.openmeld.ai/health` responds successfully                           |
| Core         | Cloudflare reports the production deployment                                      |
| Remote Agent | Cloudflare reports the production deployment                                      |
| CLI          | Signing/notarization, channel artifact, npm, tag, and Core channel gates complete |

These checks answer "is the component deployed and reachable?" They do not
prove a user workflow.

Do not build a generic browser or Wake smoke suite into CI. After deployment,
the release agent runs the smallest real-user smoke that covers the actual
change and its handover checklist. Examples:

- a Web navigation fix: open the affected production page in the real browser;
- a Space Wake change: run one published-CLI or Web Wake and capture the Space
  outcome plus `service trace` when needed;
- a CLI command fix: run that command through the published `openmeld` lane;
- an unrelated Worker refactor: confirm its page or public entrypoint and no
  5xx response.

Smoke failure is a release failure. Keep the deployed SHA and diagnostic
evidence, stop the remaining rollout, and choose a forward fix or explicit
rollback. Do not hide it by rerunning unrelated stages.

## Release Report

Every production handoff must include:

- release lane: local or GitHub;
- exact commit SHA;
- selected scope and why broader scopes were not needed;
- verification result;
- database result, including whether migrations were selected and whether any
  migration was pending;
- deployment start/end time and per-component result;
- automated health-check result;
- real-user smoke steps and conclusions;
- CLI version, update policy, notarization result, npm/R2/tag/Core alignment
  when CLI was published;
- failures, recoveries, skipped checks, and remaining work.

Never report a preview, control-plane deployment listing, direct D1 query, or
internal RPC call as completed real-user smoke.
