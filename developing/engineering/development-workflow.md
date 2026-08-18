# Development Workflow

## Agent Context

- Purpose: Define durable OpenMeld engineering workflow rules for parallel-agent
  ownership, local development, validation, lane safety, smoke evidence,
  database workflow entry points, cross-version rollout discipline, and handoff
  expectations.
- Read this when: You are coordinating parallel agent work, continuing an
  unattended task, choosing validation scope, using local CLI lanes, touching
  tests or service state, running affected/pre-push/PR checks, preparing
  real-user smoke evidence, changing a versioned local file, using Fresh Web
  Start, or changing workflow commands.
- Update this when: Parallel-agent ownership, unattended execution discipline,
  development lanes, validation gates, test isolation, smoke standards,
  database workflow entry points, or handoff evidence requirements change.
- Do not use this for: Product semantics, architecture ownership, client
  responsibility boundaries, daemon internals, command tutorials, release
  checklists, or raw command-output archives.
- Source of truth: This file owns OpenMeld engineering workflow boundaries.

## Boundary

This document defines how contributors prove changes safely.

It does not define what OpenMeld means, who owns readiness, who owns execution, how
Spaces collaborate, or how OpenMeld Service works. Those truths belong to product,
architecture, and client owner documents.

Use this document for workflow decisions:

```text
Which lane should I use?
Which validation gate proves this change?
What state must not be touched?
What evidence belongs in the handoff?
Was this real-user smoke or only internal diagnostics?
```

## Documentation Hygiene

Tracked development docs must be written in clear English.

Use `developing/` for durable, commit-safe context. Keep context routed to the
smallest owner document that changes the next action.

Use `dev-tmp/` only for local temporary material: private notes, raw
investigations, screenshots, command output, drafts, and one-off plans. Do not
make tracked code, tests, scripts, or docs depend on `dev-tmp/`.

When temporary material becomes durable knowledge, distill the stable rule into
the correct owner document. Do not migrate raw logs or long historical notes.

## Parallel Agent Development

### Lane Model

- The primary `main` checkout is the human workspace for manual development and
  the primary dev server. Agent tasks must not assume it is clean and must not
  write, migrate, publish, or deploy from it.
- Each agent development lane uses its own Git worktree. When lanes need live
  localhost stacks concurrently, use the isolated commands in
  [Parallel Worktree Dev Lanes](#parallel-worktree-dev-lanes).
- Production migrations, publication, and deployment run only from a dedicated
  clean release worktree at the exact approved `main` commit.

### Parallelism Discipline

- Before editing, every agent lane declares its planned file surface and checks
  it against every in-flight lane. An intersection requires one explicit owner
  or an agreed sequence before either lane edits the overlap; a newly discovered
  intersection stops only the overlapping work until ownership is resolved.
- Resolve concurrent changes to shared registry-style files, including existing
  schema export entrypoints, `packages/db/drizzle/meta/_journal.json`, and
  `developing/*.md`, as an additive semantic union. Preserve independent entries
  and rules from every lane, adjudicate genuine semantic contradictions through
  the owner document, and never take one side wholesale or drop unrelated
  entries. This rule does not authorize new barrel files.
- If parallel lanes generate the same next migration number, merge the first
  approved lane and rebase the later lane onto that migration history. The later
  lane removes only its own unmerged generated migration artifacts, then runs
  `pnpm db:generate` so Drizzle Kit regenerates the SQL migration, journal entry,
  and snapshot from the rebased schema history. Never hand-author or hand-renumber
  snapshot JSON, and never rename or rewrite a migration that may have been
  applied.
- After regeneration, set `LATEST_SHARED_MIGRATION_ID` to the rebased journal
  entry count and run the shared migration-history integrity test. Put an
  approved lane into the merge queue immediately instead of allowing its shared
  registries and migration base to drift.

### Release Pipeline

- A release has two stages: run `pnpm run release:preflight` for the aggregate
  read-only readiness report, then use the guarded execution entrypoint selected
  by `developing/engineering/production-release.md`. The aggregate command does
  not replace the scope-specific `release:preflight:local` deployment gate.
- Hotfixes use the same pipeline. Speed comes from exposing every prerequisite
  in one preflight, not from skipping a gate.
- `main` is PR-only. Release branches pass Fast PR and merge through a PR before
  their approved `main` commit becomes a release source. The preflight reports
  this repository policy; it does not claim to verify GitHub branch-protection
  settings.
- For a coordinated release that includes migrations, local components, and
  dependent Workers, the single order is migration, CLI/Service channel,
  scoped Worker verify/deploy, then real-user smoke. Release only what changed:
  a Worker-only or Web-only release does not publish CLI/Service merely to
  manufacture this sequence.

### Resource Discipline

- Prefer `codex exec resume` when continuing unattended work so the existing
  execution context is reused.
- Every validation or reconciliation step in an unattended work order must name
  the exact command to run, or the commander must complete and endorse it before
  handoff. The unattended executor runs only those endorsed commands.
- A background command attached to Codex must redirect standard input explicitly
  with `< /dev/null` so it cannot wait on the agent session.

## Standard Lanes

OpenMeld has three standard CLI lanes:

| Lane                   | Command               | Default home         | Use for                                  |
| ---------------------- | --------------------- | -------------------- | ---------------------------------------- |
| Published production   | `openmeld ...`        | `~/.openmeld`        | Reproducing real published behavior.     |
| Repo-local development | `openmeld-dev ...`    | `~/.openmeld-dev`    | Validating current workspace source.     |
| Packaged candidate     | `openmeld-canary ...` | `~/.openmeld-canary` | Validating a packed unreleased artifact. |

`OPENMELD_HOME` overrides the default lane root.

Each lane owns its own local state, service identity, runtime root, and system
service registration. One lane must not silently repair, reset, stop, or mutate
another lane.

Use `openmeld-dev` for normal source validation. Use `openmeld-canary` when package shape
matters before publishing. Use published `openmeld` only when the question is what
real users get from the published package.

## Local Worker Persistence

The local Worker stack must use one shared Miniflare persistence root at the
repository root:

```text
.wrangler-dev-state/
```

Auth and Core share one physical local D1 database. Root `pnpm dev` starts them
through the Auth package `dev` script with one multi-config Wrangler command:
`wrangler dev -c ./wrangler.jsonc -c ../core/wrangler.jsonc --persist-to
../../.wrangler-dev-state`. Keep Auth first so `http://localhost:8788` remains
the exposed local Auth URL. Core runs as an auxiliary Worker in the same
Miniflare instance and is reached through service bindings; do not require
`http://localhost:8787` as a normal dev-lane readiness proof.

Gateway still runs in its own package `dev` process because it owns the public
local Gateway URL and has no D1 binding. Its service bindings must connect to
the Auth/Core multi-worker process. Do not start Auth and Core as two
independent `wrangler dev --persist-to ../../.wrangler-dev-state` processes:
that creates two Miniflare D1DatabaseObject owners for the same SQLite files and
can surface as local D1 `internal error` failures.

Do not start these services with bare `wrangler dev` from inside an individual
service directory for normal dev-lane validation: Miniflare's default
`.wrangler/state` would create one physical SQLite copy per service, even when
the Worker D1 bindings all point at the same `database_id`.

Shared-DB tooling shares this same root. `pnpm db:migrate:dev`,
`pnpm db:verify:dev`, and `pnpm db:inspect:dev` resolve their local sqlite
through `.wrangler-dev-state` (migration apply runs with
`--persist-to ../../.wrangler-dev-state`), so migrations land in the exact
database the dev Worker reads. Do not point tooling at a service-local
`.wrangler/state`: that reintroduces the split where `db:migrate:dev` reports
`applied` while the dev Worker still fails with `D1_ERROR: no such column`. The
root is the single source in `getSharedLocalDevWranglerStateDirectoryPath` and a
db test pins every worker `--persist-to` to it. On the `local` worker
environment Core also warns once per isolate when the applied `d1_migrations` id
is behind the built-in migration history.

The root `pnpm dev` guard must verify the database that the local Workers will
actually open, not only compare committed migration source. After the source
check, it runs the shared physical verification against every discovered local
worker target and reads the maximum applied `d1_migrations.id`. A target behind
the built-in migration history is migrated and verified again before any dev
service starts. If the applied migration cannot be read, applied, or verified,
startup stops with the database error instead of launching a predictably broken
stack.

This shared root is local machine state and must stay ignored by git. If a
service-local split state has to be repaired, seed the shared D1 state from the
service copy that owns the current Auth users, sessions, organizations, members,
and profiles. Treat stale service-local Core Durable Object state as disposable
dev state; Spaces and Prepare/Runtime local objects can be rebuilt after the
stack restarts.

## Parallel Worktree Dev Lanes

Use the standard commands for the primary fixed-port lane and the isolated
commands when multiple worktrees need live localhost stacks at the same time:

| Command | Use |
| --- | --- |
| `pnpm dev:doctor` | Check the shared Doppler development environment without printing values. Run this first on a new computer or when startup fails. |
| `pnpm dev:worktree` | Preferred start command. Reserve a stable worktree-specific port block and start Auth/Core, Gateway, and Remote Agent with shared Doppler values. Remote Agent Sandbox tools are disabled, so Docker is not required. |
| `pnpm dev:web:worktree` | Start Web in a second terminal and attach it to the live Worker stack from the same worktree. |
| `pnpm dev:worktree:sandbox` | Start the same Doppler-backed Worker stack with Remote Agent Sandbox tools enabled. Docker is required. |
| `pnpm dev` | Start the exclusive fixed-port Worker stack for the current worktree. DevGuard blocks before Turbo if another worktree owns a required port and does not stop that owner. |
| `pnpm dev:web` | Start Web on the fixed-port lane after `pnpm dev` is ready. |
| `pnpm dev:isolated` | Legacy low-level isolated stack for checkouts that still use local environment files. |
| `pnpm dev:isolated:no-sandbox` | Legacy Docker-free isolated stack for checkouts that still use local environment files. |
| `pnpm dev:isolated --test-scheduled` | Legacy isolated stack that also prints its loopback-only Routine scheduler trigger. |
| `pnpm dev:web:isolated` | Legacy low-level Web attachment for checkouts that still use local environment files. |

For normal localhost development, use two terminals in the same worktree:

```bash
# Terminal 1
pnpm dev:worktree

# Terminal 2, after the Worker stack is ready
pnpm dev:web:worktree
```

The first Web page load can take about one minute while Web and Cloudflare
compile. Keep the page open; later loads should be fast. This message is also
printed by the launcher so a newcomer does not mistake first compilation for a
failed start.

For a localhost Routine smoke, start the Worker stack with
`pnpm dev:worktree -- --test-scheduled`, create an enabled Routine through Web,
then run the printed command to trigger one Core minute-scheduler tick:

```bash
curl -X POST "http://localhost:<isolated-gateway-port>/__dev/routines/tick"
```

The route exists only when the Gateway is running with
`OPENMELD_WORKER_ENVIRONMENT=local` and Wrangler identifies a direct loopback
client. Forwarded tunnel traffic and deployed Workers receive `404`. Gateway
calls Core through the existing Service Binding, so Auth and Core keep their
normal single Wrangler process and one local D1 owner. The trigger runs the same
Core scheduler used by the minute Cron; it does not create or edit Routine or
Run rows itself.
Validate the resulting Run and final Space reply through Web; do not create or
edit Routine rows directly.

For a real Slack smoke, start the same stack with the current tunnel callback
instead of editing `wrangler.jsonc`:

```bash
OPENMELD_SLACK_OAUTH_REDIRECT_URL="https://<current-tunnel-host>/slack/oauth/callback" \
  pnpm dev:worktree -- --test-scheduled
```

Configure that exact callback, plus `/slack/events` and `/slack/interactive`,
on the Dev Slack App. The tunnel must forward to the isolated Gateway port,
not the Web or Core port. Keep the tunnel URL ephemeral and out of tracked
configuration.

A Git worktree does not copy ignored local secret files. The preferred shared
environment path is `pnpm dev:doctor`, followed by `pnpm dev:worktree` and
`pnpm dev:web:worktree`. The runner supplies the same authorized Doppler `dev`
configs to every worktree without copying files. Legacy package-local
`.dev.vars` files remain supported by the low-level commands during the
migration, but the Doppler runner fails if one would shadow its process
environment. Secret ownership, safety, and onboarding are defined in
`developing/engineering/environment-and-secrets.md`.

Both isolated stack commands print the lane ID, actual localhost URLs,
persistence root, and effective `OPENMELD_HOME`. Do not assume the fixed
3000/8080/8788/8790 ports in an isolated lane. Use the printed URLs.
`pnpm dev:web:worktree` fails closed unless the same worktree has a live
isolated Worker stack.

Do not start or set up OpenMeld Service for a Web-only smoke that does not need
local Agent execution. When Service validation is required, diagnose ownership
through the lane-specific `openmeld service status` output. A machine-wide
`launchctl list` or process list can legitimately contain production and
dev-local Services at the same time and is not evidence of multiple owners in
one lane.

Agents should use `pnpm dev:worktree` by default when the touched
scope is limited to Research, Browser Run, stateless Code Mode, model execution,
or ordinary OpenMeld product tools. This launcher passes
`--enable-containers=false` only to Remote Agent Wrangler and selects the
no-network in-memory Sandbox adapter, so it neither builds a container image nor
calls the Cloudflare Sandbox binding. Research, Browser Run, Code Mode, and
ordinary product tools remain available; shell and Sandbox file tools are
intentionally absent.

The lightweight Remote Agent keeps its Flue and Durable Object state in the
lane's `remote-agent-no-sandbox/` persistence subdirectory. This prevents its
Sandbox-free migration set from rewriting the complete lane's migration
history. Auth, Core, Gateway, and the lane identity stay the same, but Remote
Agent conversation state is intentionally not shared when switching between
the lightweight and complete commands.

This lane is not valid Sandbox evidence. If a change touches Sandbox tools,
container bindings, shell execution, Sandbox files, or the interaction between
Code Mode and Sandbox, use `pnpm dev:worktree:sandbox` with Docker and prove at
least one real shell or file operation before declaring the change done. Use
that complete lane as the final combined-capability regression when a release
changes both Sandbox and another Remote Agent tool family.

Each isolated lane owns all of the following:

- public Web, Gateway, Auth, and Remote Agent ports
- Worker inspector ports
- one lane-specific Wrangler service registry, so local service bindings cannot
  connect to a Worker from another worktree
- one lane-specific Miniflare persistence root under
  `.wrangler-dev-state/isolated/<lane-id>/`
- one lane-specific `OPENMELD_HOME` under
  `.turbo/dev/isolated/<lane-id>/openmeld-home/`

The shared lane registry lives under the repository's Git common directory so
all worktrees coordinate allocation. A live owner is never stopped or reclaimed.
The launcher reclaims a lane only after its recorded owner PID is dead, and it
skips a port block already owned by an unrelated process. Starting an isolated
lane does not bypass the normal Node, shared-DB migration, build, or readiness
guards.

Isolated D1, Durable Object, and local OpenMeld state intentionally do not share
accounts or application data with the fixed-port lane or another worktree. Seed
or create the test data needed by that lane through normal local development
flows. Use isolated lanes for parallel agent validation; keep `pnpm dev` as the
predictable default when only one full stack is needed.

## Desktop GUI Lane Scripts

When validating OpenMeld Desktop GUI behavior that talks to the CLI, OpenMeld Service, or
OpenMeld Web, use the repo-root Desktop scripts instead of plain
`pnpm -C clients/desktop dev`.

The root `pnpm dev` local stack does not start OpenMeld Desktop. Keep Desktop in a
separate terminal, the same way Web is started separately with `pnpm dev:web`.
Electron binary download or `Electron uninstall` failures belong to the Desktop
lane. Hydrate the binary with
`pnpm --filter @openmeld/desktop exec electron --version`, then
rerun `pnpm dev:desktop`; do not reattach Desktop to root `pnpm dev`.

| Script                          | Lane                                     | Behavior                                                                                                                                     |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:desktop`              | `openmeld-dev` / `~/.openmeld-dev`       | Alias for `pnpm run desktop:dev`; builds and installs the repo-local CLI wrapper, then starts Electron against local Gateway/Auth/Web.       |
| `pnpm run desktop:dev`          | `openmeld-dev` / `~/.openmeld-dev`       | Builds and installs the repo-local CLI wrapper, then starts Electron against local Gateway/Auth/Web.                                         |
| `pnpm run desktop:start:dev`    | `openmeld-dev` / `~/.openmeld-dev`       | Starts Electron against an already-installed `openmeld-dev` wrapper.                                                                         |
| `pnpm run desktop:canary`       | `openmeld-canary` / `~/.openmeld-canary` | Installs the packaged candidate wrapper, then starts Electron against local Gateway/Auth/Web. This can run package release-readiness checks. |
| `pnpm run desktop:start:canary` | `openmeld-canary` / `~/.openmeld-canary` | Starts Electron against an already-installed `openmeld-canary` wrapper.                                                                      |
| `pnpm run desktop:start:prod`   | `openmeld` / `~/.openmeld`               | Starts Electron against the published production lane for explicit production reproduction only.                                             |

These scripts align `OPENMELD_BIN`, `OPENMELD_ENV_PRESET`,
`OPENMELD_USER_FACING_CLI_COMMAND`, `OPENMELD_GATEWAY_URL`, `OPENMELD_AUTH_URL`, and
`WEB_APP_URL`. Do not validate Desktop lane behavior with a mixed CLI/Web/Auth
environment.

## `OPENMELD_HOME` And Production-State Safety

The published `~/.openmeld` lane is real user state.

Tests, fixtures, e2e runs, snapshots, local harnesses, and destructive
validation must not read from or write to `~/.openmeld` unless the task explicitly
validates the real installed product and the user asked for that exact
validation.

Any test or script that touches OpenMeld Service lifecycle, service contracts,
bundles, runtime leases, daemon device IDs, launchd/system service registration,
local-state repair/reset, Prepare runtime reporting, or service state must use:

- a fresh temporary `OPENMELD_HOME`
- `openmeld-dev`
- `openmeld-canary`

Tests that mutate service state must assert the effective lane root before
mutation and fail immediately if it resolves to the production lane
unexpectedly.

Fixture identities must stay inside isolated test stores.

Managed agent skills directories (`~/.claude/skills` and the other registry
defaults) are shared real-user state owned by the published `~/.openmeld` lane.
The CLI enforces this: with a lane-specific OpenMeld home (`openmeld-dev`,
`openmeld-canary`, or any `OPENMELD_HOME` override), skills detection, tracking,
install, and readiness skip the registry-default agent directories, and
`skills ensure --all` is a safe no-op there so setup completes inside dev
lanes. Lane-local skills validation must use explicit targets (`--dir`, config
custom targets, or per-agent `globalSkillsDir` overrides). A lane that links a
shared agent directory at its own skills store hijacks the published install
and leaves a dangling link when the lane is deleted.

## Verification Gates

Choose the smallest validation gate that proves the change.

### Practical Test Standard

Tests are a risk-control tool, not a deliverable quota. Do not add a test merely
because a file changed, and do not require one test file per production file.
Every new test must identify the user-visible behavior, invariant, or boundary
failure that it protects.

Add or update a test when at least one of these is true:

- the change affects authorization, identity, tenancy, privacy, data loss, or
  another security boundary
- the behavior has branching rules, state transitions, concurrency, retries,
  timeouts, idempotency, or failure recovery that a reviewer cannot prove by
  inspection alone
- the change writes durable data, performs a migration, or changes an
  irreversible operation
- the change alters a shared schema, cross-process contract, external API
  boundary, or version-compatibility rule
- a real bug needs a deterministic regression test and there is a focused seam
  that would fail for the bug

Usually do not add a test for:

- CSS classes, spacing, widths, ordinary visual layout, hover behavior, or
  animation; verify these in a real browser when they matter
- type-only changes, generated files, re-exports, static constants, or behavior
  already enforced by the compiler, linter, or build
- a branch-free wrapper that only composes components whose behavior is already
  covered at the owning seam
- implementation details, call order, private helper structure, or snapshots
  without a stable product contract
- ordinary copy changes, unless the wording carries legal, privacy, security,
  accessibility, destructive-action, or critical recovery meaning

Choose the cheapest layer that can catch the real failure:

1. Use a pure unit test for branching rules and deterministic transformations.
2. Use a boundary or contract test for schemas, versioning, persistence, and
   external payloads. External mocks must come from captured responses or vendor
   types.
3. Use an integration test only when the risk is the interaction between real
   boundaries, not when a unit test can prove the rule.
4. Use browser smoke for layout, pointer behavior, navigation, focus, and other
   rendered behavior that jsdom cannot prove.

For a bug fix, reproduce the bug with a focused failing test before the fix when
the seam exists and the test is deterministic. Do not manufacture a brittle
test for a trivial edit solely to claim TDD. A slow test must justify the real
boundary it exercises; replace real waits with fake clocks or injected time
when elapsed time is not the behavior under test.

Run focused validation first. Expand to affected packages when the change crosses
package boundaries. Run integration suites only for the boundaries they prove.
`test:full` and manually dispatched Deep Confidence are exhaustive diagnostics,
not the default closeout step for every change.

### Gate Commands

Canonical command families:

- focused package tests and checks for narrow changes
- `pnpm check`
- `pnpm build` when build output or package surfaces change
- affected checks: `check:affected`, `test:affected`,
  `test:integration:affected`
- release-style gates: `verify:pre-push`, `verify:pr`

`verify:pre-push` is intentionally limited to dependency consistency, static
workflow and environment contracts, retired identifiers, and local-component
release readiness. Affected workspace checks, unit tests, and their dependency
builds belong to `Fast PR` and must not be added to the hook.

`Fast PR` is the stable pull-request gate. A short planning job starts beside
static contracts and affected workspace checks. As soon as planning finishes,
affected unit tests fan out without waiting for the static lane, then one
required `Fast PR` aggregate status verifies every lane. Static contracts
include dependency rules, Cloudflare environment contracts, retired
identifiers, documentation and release workflow contracts, and local-component
release readiness against `origin/main`.

One planner reads Turbo's affected test graph before scheduling unit work. It
installs only the pinned Node.js and pnpm toolchain, then runs the repository's
exact Turbo version without restoring the full dependency cache or installing
workspace dependencies. Web
uses three Vitest shards, CLI uses two, and the Core Node boundary suite uses
two; a heavy suite is scheduled only when that package has an affected `test`
task. All remaining affected workspace tests stay in one Turbo lane. Turbo
still builds the upstream workspace dependencies required by those tasks, but
Web unit tests resolve their workspace dependencies from source and use a
dependency-graph transit task for cache invalidation instead of materializing
compiled package output. The required gate does not automatically retest every
downstream consumer. Package checks or tests that intentionally import their
own built public surface must declare that package build explicitly, so a cold
runner cannot race typechecking against output generation.
Each substantive job has a 20-minute window; the aggregate job only verifies
the upstream results.

Fast PR jobs cache only `.turbo/cache`, with keys isolated by toolchain
configuration, job or shard, and revision. GitHub scopes pull-request caches to
that PR's merge ref, so the cache accelerates retries and later revisions of the
same PR without becoming release evidence or a cross-PR trust channel. Deploy
workflows do not restore this cache. Successful Turbo tasks use error-only logs
with hash-level progress, while failed tasks retain their complete logs; direct
Vitest shards use the dot reporter and suppress console output from passing
tests.

Use `verify:pr:full` when a change crosses shared package boundaries and needs
checks, unit tests, and integration tests across changed workspaces and their
downstream dependents. It is explicit confidence evidence, not the default
required gate. A lockfile change still uses the dependent-aware path when its
owner cannot be proven. The only explicit narrow lockfile path is a checked-in
dependency patch whose lockfile diff changes only that patch's generated
hashes, plus changes inside its consuming workspace; the affected runner then
selects that workspace and its dependents.

Draft pull requests do not start `Fast PR`; marking one ready for review starts
the gate, and converting it back to draft cancels the in-flight run. Post-merge
CI keeps the local-component manifest guard plus a narrow CI Contract Guard.
Both use workflow-level path filters so ordinary product pushes do not start a
runner. The CI Contract Guard runs only when CI or release infrastructure
changes and repeats only its cheap static contracts, never affected workspace
tests or release-ready builds. The local-component guard's in-job push-base
selector remains defense in depth, and manual dispatch uses current-facts
verification. Deploy, CLI release, and package publication paths remain forced
release-ready gates where the owning release invariant requires them. Do not
add a broad `main` confidence workflow that repeats PR checks after every merge.

Deep Confidence is manual and runs Core Worker integration tests in
deterministic Vitest file shards. Each matrix job must invoke exactly one direct
Vitest shard; do not call the package's internally sharded integration script
and append a second `--shard` flag. Each shard owns a fresh `workerd` process
because the Core pool intentionally uses shared storage and one Worker within a shard; combining
the full suite into one process accumulates heap across test files and can turn
passing behavior into an infrastructure-only OOM. Keep CLI shards coarse enough
that checkout, dependency installation, and setup do not dominate useful test
work.

If affected scripts need a base ref, fetch it or set `OPENMELD_AFFECTED_BASE`
explicitly. Do not ignore a missing-base result.

When a package-level script needs repo-root Turbo behavior from another working
directory, use the repo-root form with `pnpm -C <repo-root> exec turbo ...`.

## User-Operable Validation

User-facing changes need both technical validation and user-operable validation.

Technical validation proves the contract in tests and checks.

User-operable validation proves the flow through an entry point a real user or a
context-free agent can operate, such as:

- OpenMeld Web UI
- published OpenMeld CLI
- `openmeld-dev`
- `openmeld-canary`
- installed OpenMeld Service commands
- product-supported trace or diagnostic commands

A flow is not validated if it only works through hidden routes, hand-built
payloads, private IDs, seeded product state, or internal repository knowledge.

If a user-facing path requires hidden context to operate, treat that as a
product or diagnostics gap.

## Real-User Smoke Vs Internal Diagnostics

Real-user smoke must use user-accessible entry points and show user-visible
evidence.

Internal diagnostics are not smoke evidence by themselves.

These are internal diagnostics unless paired with a real user path:

- direct internal HTTP/RPC calls
- Cloudflare Worker subrequests
- D1 SQL reads or writes
- Durable Object storage or alarm inspection
- Queue inspection
- admin scripts
- manual cookie or localStorage edits
- DB row edits
- direct trace/projection state edits

If internal diagnostics are needed, label them as diagnostics in the handoff. Do
not report them as user workflow validation.

Production smoke must not bypass login, Auth, Binding, OpenMeld Service, daemon
delivery, Space display, traceability, or user-visible failure handling.

## Evidence Alignment

Readiness, routability, Binding, claim, execution, trace, and dashboard display
states must prove that their evidence belongs to the exact object being shown.

Validation should keep the same identity chain where relevant:

```text
Agent Profile
Space
source message
clientMessageId
targetProfileId
Binding
Runtime
lane
Wake trace
```

Wrong-but-plausible evidence must fail closed. It must not produce a false
`Ready`, false claimability, false routability, false execution success, or
false visible outcome.

## Trace And Diagnostics Workflow

Wake trace validation uses the shared selector shape:

```text
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

Repo-local wrappers may exist, but they must stay thin wrappers around the same
selector and read model. For local lanes, the same selector shape runs through
`openmeld-dev` with `--gateway-url http://127.0.0.1:8080`.

Local stack diagnostics before or alongside a trace:

```text
curl -i http://localhost:8080/v1/diagnostics/chain   # Gateway reach to Auth and Core
openmeld-dev auth status --view human                     # auth session and selected profile
openmeld-dev whoami --view agent                          # CLI/auth/profile/daemon coherence
pnpm run test:e2e:gateway:cli                        # Gateway/Core/CLI smoke
```

Workflow scripts must not become direct D1 readers, direct Durable Object
readers, or a second trace system.

New cross-boundary behavior must stay diagnosable end to end. Before finishing
a flow that crosses Web, CLI, Gateway, Core, Durable Objects, shared D1,
daemon, or agent runtime boundaries, verify:

- one stable correlation key exists before the first network hop, and every
  boundary forwards, persists, or derives it (indexed where lookup speed
  matters)
- a trace or lookup API can find the flow by that key after the fact, and
  no-match lookups return structured evidence instead of a generic error
- schemas in `packages/schemas` cover request, response, and diagnostics
- tests cover success, failure, no-match, and malformed-selector cases

Trace semantics and sensitive-data rules belong in
`developing/architecture/data-and-observability.md`.

## Manual Deploy Gate

Production release lane selection, scopes, database sequencing, CLI rollout,
health checks, smoke boundaries, and reporting are owned by
`developing/engineering/production-release.md`.

The development workflow contributes two non-negotiable gates:

1. local-component changes must pass `pnpm run verify:release-ready` and carry
   a truthful `release/local-components.json` policy;
2. any Core deploy must prove the production CLI channel can satisfy the local
   component version Core is about to project.

The guarded local and GitHub release entrypoints enforce these checks. Do not
bypass them with raw package deploys, raw `wrangler deploy`, or raw npm publish.
When a gate fails, fix or restamp the final release commit and rerun the same
scoped entrypoint. Do not use a skip flag as a normal deploy path.

## Contract Impact Audit

Complete this audit before marking an implementation done and before any manual
deploy when the diff touches CLI, OpenMeld Service carrier files,
OpenMeld-managed local helper skills, Organization Skill delivery,
daemon/runtime schemas, Prepare Session schemas, shared HTTP/RPC/WebSocket
schemas, or `release/local-components.json`.

This is a design judgment, not a release-tool result. The release-ready gate can
detect stale artifacts, changed sensitive paths, and contract constants that
already changed. It cannot decide whether an implementation forgot to bump a
contract constant. An unchanged `OPENMELD_CLI_COMMAND_CONTRACT_VERSION`,
`CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH`, `OPENMELD_SERVICE_CONTRACT_VERSION`, or
`OPENMELD_SKILLS_CONTRACT_VERSION` is only valid after the audit below is answered.

Answer these questions in the PR, task handoff, or release note:

- Which external or cross-process boundary changed: CLI command behavior,
  OpenMeld Service runtime transport, Service carrier/install behavior,
  OpenMeld-managed local helper skills, Organization Skill exact-release
  delivery, daemon schemas, Prepare Session payloads, shared
  HTTP/RPC/WebSocket schemas, or local-component release policy?
- Can old cloud code talk to the new local component, and can new cloud code
  talk to the old local component during rollout? Check setup, Wake dispatch,
  dispatch-owned Space actions, `openmeld service status`, trace/diagnostics, and
  the self-rescue commands.
- If an old local component cannot safely continue the affected capability,
  bump the owning contract constant, stamp that component `required`, update the
  owner document, and explain the user-visible failure being prevented.
- If the change is artifact-only or backward-compatible, stamp touched local
  components `available` when needed and explain why existing users can keep
  running current Wake/setup work without being blocked.
- If compatibility depends on deploy order, write that order down and keep the
  mixed-version window short. Do not leave a published CLI, Core deployment, or
  Web build depending on an unstated ordering assumption.
- The default coordinated cloud deploy order is Auth, then Web, then Gateway, then Core, then Remote Agent.
  Apply any selected Database migration before Auth. Auth deploy and health must
  complete before Web can expose callers for a new Auth receiver. Component-only
  releases still deploy only their selected component, so Web-only skips Auth
  instead of redeploying it. Rollback removes the Web caller before rolling Auth
  back and retains additive nullable migrations unless their owning contract
  explicitly requires a separate data rollback. Remote Agent remains after Core
  because the hosted worker sends native-delivery callback payloads that Core
  validates. Published CLI versions can never be forced to update first, which
  is why shared response schema additions must be optional (see
  `developing/architecture/shared-contracts.md`).
- Hosted Remote Agent service-binding changes may create dependencies in both
  directions. Deploy new Core RPC receivers and versioned audit readers before
  the Remote Agent callers that use them. Deploy Web/Gateway readers for a new
  strict public response enum before Core can emit it. New Remote Agent RPC
  receivers may then deploy after Core only when Core treats their absence as a
  stable, retryable capability gap rather than success. Record each direction
  separately; a single generic "Core before Remote Agent" statement is not a
  Contract Impact Audit.

### Local Agent Interaction Contract Impact Audit

The local Agent Interaction rollout changes shared HTTP/RPC/WebSocket schemas,
Runtime Transport frames, RuntimeCoordinator state, the OpenMeld Service
carrier, and all supported local-agent adapters. It does not change setup,
Prepare Session, dispatch-owned Space Action, diagnostic, or D1 schemas.

- Old cloud -> new local component is not a supported rollout direction for
  interactive Wakes. Old Core cannot route the new strict interaction request
  frame and may leave the provider waiting.
- New cloud -> old local component remains safe for existing Wake, setup,
  status, trace, result, and Space Action paths. The old Service emits no
  interaction frames and retains its previous explicit fail-closed behavior,
  but it cannot satisfy the new Space interaction capability.
- Deploy Web, then Gateway, then Core/Runtime Transport, then stamp and publish
  the CLI/Service local component. Keep the final window short and stamp the
  touched CLI and Service components as advisory `available`: existing Wake
  work remains safe, while the old Service retains the previous explicit
  fail-closed behavior when a provider asks. Existing local-component update
  surfaces advertise the newer Service without blocking unrelated Wake work.
- `pendingInteraction` is optional on Wake progress, so new consumers accept
  old Core responses. No existing daemon frame changed; new request, response,
  and delivered codes are emitted only after the receiver deployment. No
  contract constant or D1 migration is required for this additive ordered
  rollout.
- Rollback disables the new local producer before rolling Core back. An
  already-running interaction must be stopped or allowed to reach an explicit
  terminal outcome; rollback must not strand a provider waiter or rewrite
  RuntimeCoordinator state.

### Agent Reply Context Review Contract Impact Audit

Agent reply context review changes the shared Runtime Transport capability and
result-response schemas, the Service result outbox and exact-conversation
continuation path, RuntimeCoordinator result settlement, and Space atomic final
reply publication. It does not change setup, Prepare Session, CLI command,
Gateway HTTP, D1 schema, or controller-specific adapter contracts.

- Old cloud -> new local is not a safe rollout direction. The frozen base
  capability envelope is strict, so an old Core can reject the new
  `agentReplyContextReview` field. Deploy shared-schema consumers and Core
  before publishing a Service that advertises the capability.
- New cloud -> old local remains safe. An old Service omits the capability, so
  Core never emits `review_required` and preserves the previous accepted-result
  flow for existing Wake, setup, status, trace, and Space Action behavior.
- New cloud -> new local enables atomic `post_message` settlement. A stale
  proposal is not accepted into the result inbox and does not retire execution
  authority. Service removes only that proposal from its durable outbox,
  resumes the exact controller conversation with a bounded Space cursor delta,
  and submits the replacement under the same Wake.
- No Runtime Transport epoch or Service contract bump is required because the
  response addition is emitted only behind the explicit session capability and
  new Core remains compatible with old Services. The local component remains an
  `available` update rather than a forced update: old Services retain their
  pre-existing behavior and are not sent an incompatible status, while the
  stronger collaboration guarantee activates after update.
- Rollback removes or disables the Service capability producer before rolling
  Core back. Existing accepted results remain on the established finalization
  path; a non-terminal review in progress must be allowed to settle or be
  explicitly stopped, never rewritten into success or failure.

### Grok Build Harness Contract Impact Audit

Grok Build support adds one runtime registry controller, model-catalog entry,
controller-native permission values, ACP conversation capability, CLI ACI
definition, Service installer, and adapter package. It reuses the existing
RuntimeAdapter, Agent Interaction, Binding, Runtime Transport, Space Action,
diagnostic, and finalization envelopes. No existing daemon frame shape, Prepare
Session shape, Runtime Transport contract epoch, Service contract version, CLI
command contract version, or D1 schema changes.

- Old cloud -> new local remains safe for existing controllers. The new Service
  may detect and report Grok as an additional generic controller capability, but
  old cloud cannot create a Grok Binding or permission intent it does not know.
  Grok execution therefore stays unavailable rather than being misrouted.
- New cloud -> old local remains safe. An old Service does not advertise or
  install the Grok adapter, so Core readiness fails closed for a Grok-bound
  profile while all previously supported controllers retain their existing
  setup, Wake, status, trace, and Space Action behavior.
- Deploy shared-schema consumers and the Core-served model catalog before
  exposing Grok selection in Web/Gateway, then publish the CLI/Service producer.
  The local release is advisory `available`, not `required`: users can continue
  existing work without Grok, while a Grok-bound profile accurately remains
  unavailable on an old Service.
- No contract constant bump is required because the new strict permission enum
  values are emitted only after their cloud receivers deploy, the controller
  registration is additive, and all execution/result envelopes are unchanged.
  The feature branch must use deferred release verification; version bump and
  local-component manifest stamping happen only in the clean release worktree.
- Rollback removes or disables the Grok local producer before rolling back the
  shared cloud receivers/catalog. Any active Grok Wake must first reach one
  explicit reply, stopped outcome, or failure; rollback must not reinterpret a
  Grok ACP session as another controller or retry it through Headless JSON.

### Center Agent Local Agent Bridge Contract Impact Audit

The Center Agent Local Agent bridge adds the `openmeld center-agent ask`
command, optional Local Agent source metadata on the existing Center Agent Chat
ingress, the `receive_local_agent_request` Audit Log action set v14, Center
Agent Task response contract v3, and nullable Task origin attribution in shared
D1 migration `0106_flimsy_angel`. It does not change setup, Prepare Session,
Runtime Transport, Wake execution, dispatch-owned Space Actions, Service
status, trace selectors, or self-rescue commands.

- Apply D1 migration `0106_flimsy_angel` before deploying the Core reader and
  writer. Existing Tasks remain readable with null attribution; Core owns the
  new source projection and never treats private Local Agent session locators as
  Task or Audit Log provenance.
- Deploy Core first, then Gateway, Web, Remote Agent, and finally publish the
  CLI. This receiver-first exception to the default cloud order is required:
  old Web and Gateway clients continue requesting frozen Task v2 and Audit Log
  action sets through v13, while new Core accepts both the old and new explicit
  versions. New Gateway and Web may request v3/v14 only after the Core receiver
  is live. Remote Agent must accept the optional interaction source before a
  published CLI can cause Core to include it in a worker request.
- Old cloud code cannot serve the new CLI command because its strict Center
  Agent Chat ingress does not recognize the Local Agent source field. Publish
  the CLI only after the cloud chain is ready. New cloud code remains compatible
  with old CLI, Web, and Remote Agent callers because the new request source is
  optional and old Task and Audit Log response versions remain frozen.
- Stamp the CLI as advisory `available` in the release worktree. Existing
  setup, Wake, status, trace, Space Action, and Center Agent Chat work remain
  safe without the new command, so this addition does not justify blocking
  unrelated work or bumping the CLI command contract constant.
- Rollback before CLI publication may reverse the deployment order normally.
  After CLI publication, retain the additive Core/Gateway receiver until the
  CLI command is no longer in the supported channel. Rolling it back sooner
  makes only the new command explicitly unavailable; it must not reinterpret
  the request as an unattributed Web message or silently lose Audit Log or Task
  provenance.
- When the guarded release plan includes the CLI, its first Core deploy compiles
  the currently published CLI manifest from that version's immutable tag. The
  final CLI release publishes the new artifacts and then redeploys Core with the
  checked-in manifest. This keeps the documented receiver order without making
  Core advertise an unavailable CLI during the rollout.

The progressive read side adds shared Context Manifest v1, Audit Log action set
v15, `openmeld center-agent context`, and D1 migration `0107_heavy_stick`.
Apply `0107_heavy_stick` before deploying Core because the Core audit reader
left-joins the manifest table. Then deploy Core, Gateway, Web, and publish the
CLI. Old clients remain on earlier explicit Audit Log action sets and do not see
the new action; new clients request v15 only after the Core receiver is live.
Rollback retains the additive migration and Core reader while any published CLI
may call the endpoint. The change does not alter Prepare, Runtime Transport,
Wake, Service, Space Action, Task execution, or Flue conversation contracts.
The guarded receiver-first plan uses the same two-phase Core projection above,
so this order never exposes the new CLI early and never advertises its version
before the binary channel contains it.

The Center Agent Context Scope Plan adds one optional strict field inside the
existing Remote Agent turn envelope. Deploy Remote Agent first so its strict
receiver accepts both old envelopes and `contextScopePlan.v1`, then deploy Core
so every new turn freezes and emits the plan. New Remote Agent remains
compatible with old Core by deriving the same plan from existing authoritative
sender and environment facts. New Core must not precede the new Remote Agent:
an old strict worker rejects the additional envelope field. Gateway, Web, CLI,
OpenMeld Service, setup, Prepare, Space Action, and diagnostics contracts do not
change. Rollback stops the Core emitter before rolling Remote Agent back; no D1
migration, local-component contract bump, or release stamp is required for this
hosted additive contract.

The Context Load Receipt side adds shared receipt v1, Audit Log action set v16,
`openmeld center-agent context receipt`, and additive D1 migration
`0108_tiresome_magik`. The migration creates the manifest-materialization and
load-receipt tables without rebuilding the existing manifest ledger.

- Apply `0108_tiresome_magik`, then deploy Core, Gateway, Web, and finally the
  CLI. Core must exist before Gateway forwards the new receipt RPC or clients
  request audit v16. Old Gateway, Web, and CLI versions remain on audit v15 or
  earlier and continue working against new Core.
- Publish the CLI only after the cloud receiver chain is live. A new CLI
  against old cloud must fail explicitly; it must not print a local-only receipt
  or reinterpret an unverified load as success.
- An old manifest has no materialization row and therefore cannot produce a
  receipt. The client requests fresh context instead. Existing manifests and
  audit reads remain valid.
- Rollback removes the CLI caller and Web v16 reader first, but retains the
  additive migration and Core reader while receipt rows exist. Audit v15 and
  older continue filtering the new action, so frozen clients never receive an
  unknown enum or optional detail shape.
- This phase changes no Prepare, Runtime Transport, Wake, Service, Space Action,
  Task execution, or Flue conversation contract. The CLI remains an advisory
  local-component update and requires the ordinary release stamp before
  publication.

The requester-provenance side adds Routine actions to the shared Audit Log enum,
Audit Log action set v17, and an optional Local Agent interaction-source
projection on downstream Center Agent actions. It reuses the existing
`source_native_delivery_id` column and Local Agent request row, so it needs no
D1 migration and creates no second artifact or transcript store.

- Deploy Core first so it can accept `actionSet=v17`, filter Routine actions for
  v16 and older callers, and return interaction source only to v14-or-newer
  callers. Then deploy Gateway and Web. No CLI, OpenMeld Service, Remote Agent,
  Prepare, Runtime Transport, Space Action, Task execution, or Flue conversation
  contract changes in this phase.
- The source writer accepts a delivery only when its active submission matches
  the Organization, designated Center Agent, represented Human Profile, and
  user. Missing or mismatched evidence leaves the action unlabelled and does not
  block the authorized work.
- Rollback removes the Web v17 reader first, then Gateway. Retain the additive
  Core reader and older action-set filters while durable Routine audit rows
  exist; v16 and older callers continue receiving their frozen action set.

The Center Agent Organization-targeting CLI phase adds optional
`--organization <slug-or-id>` input to `center-agent ask`, `context`, and
`context receipt`. It reuses the already-deployed Auth Organization membership
endpoints and canonical Gateway requested-Organization header; it adds no cloud
receiver, migration, Service carrier behavior, Runtime Transport frame, Prepare
payload, Space Action, diagnostic contract, or new conversation store. It adds
one strict shared Agent View schema for the CLI-owned frozen Organization scope;
that local machine-output contract does not require a cloud receiver.

- Without the option, the CLI reads Auth's current account
  `lastSelectedOrganizationId`, falls back only to the remote Better Auth
  Session active id when the account preference is absent, resolves that id
  through the current membership list, and binds it for the whole command.
  With the option, it resolves a current membership and does not mutate the
  account default. Gateway and Auth still reauthorize the requested id; the
  CLI selector is never authority.
- Current cloud already accepts the canonical selector, so new CLI to current
  cloud and old CLI to current cloud are both compatible. A cloud version from
  before that selector contract is not a supported receiver for explicit
  targeting because ignoring the header could route to the Session
  Organization. Publish only against a release whose Gateway/Auth status is
  current.
- The CLI, mechanically rebuilt Service bundle, and managed CLI skill changes
  are advisory `available`. The Service bundle hash changes because the bundle
  carries the packaged CLI, not because its carrier or runtime protocol
  changed. Existing setup, Wake, Service status, trace, diagnostics, Space
  Action, and Center Agent Chat behavior remain safe, so no command, Service,
  Skill, or Runtime contract constant changes. Rollback is CLI-only.

### Codex Collaboration Mode Contract Impact Audit

Codex Collaboration Mode adds nullable D1 Binding metadata, shared
Binding/Gateway/Core schemas, negotiated expected-routes v2 output, local route
cache metadata, Center Agent model-visible runtime-setting inputs, and Codex App
Server `turn/start` behavior. It does not change Runtime Transport frames,
setup, Prepare Session, Space Actions, Wake outcome authority, or existing v1
expected-routes output.

- Apply D1 migration `0079_curvy_rocket_raccoon` before deploying the Core
  reader/writer. Existing rows remain valid and retain Codex Default execution
  semantics without emitting a new response field.
- Deploy the Core receiver after the migration, then Gateway, Web, and Remote
  Agent callers. A new Web against an old Gateway cannot save the new setting,
  but unchanged existing Binding edits do not manufacture a
  collaboration-mode write. An old Remote Agent omits the optional field and
  remains compatible; deploy the new Remote Agent after Core so a Center Agent
  cannot send the new field to an old strict RPC receiver.
- Core omits Collaboration Mode from the unversioned readiness response and
  returns stored values only from explicit owner Binding reads and writes. This
  prevents old strict Gateway/Web readiness readers from rejecting every legacy
  Codex Binding during the cloud rollout.
- Old local components keep requesting strict expected-routes v1 and receive
  the unchanged response shape. New local components request
  `contractVersion=v2`; against an old cloud they retry v1 only after a
  400 `invalid_payload` in either the direct Gateway code or legacy upstream
  alias, preserving ordinary Wake behavior with Codex Default. Network and 5xx
  failures remain visible failures.
- Publish the CLI/Service component after cloud rollout and stamp it advisory
  `available`. Existing setup, Wake, status, trace, diagnostics, result, and
  Space Action paths remain safe on the old component; only the new Plan
  collaboration behavior is unavailable until update.
- The derived route-cache schema advances from v2 to v3. New readers keep v2
  support and persist both the controller-native value and derived
  conversation policy in v3. An old binary treats a v3 cache as a cache miss
  and rebuilds its projection instead of rewriting Binding truth; no runtime
  contract epoch or service contract version bump is required.
- The installed App Server contract and a live `collaborationMode/list` capture
  advertise Plan with a nullable model and medium reasoning effort.
  `developer_instructions=null` is the protocol-defined request for the
  provider's built-in Plan instructions. Default turns tolerate a thread
  response that omits model; Plan fails explicitly unless a selected or
  thread-resolved model is available.
- Rollback switches affected Bindings to `codex:default` before removing the
  new local producer, then withdraws Web/Gateway and Remote Agent callers before
  Core. The nullable D1 column remains in place; rollback must not rewrite
  Binding rows or active RuntimeCoordinator execution state.

### Versioned local-state rollout discipline

A versioned local file is a cross-version contract even when it never leaves
one computer. Roll it out consumer before producer:

1. release every supported reader that can safely parse the new version;
2. make an unknown newer version fail closed with an update-required error;
3. activate any same-machine component-version gate needed to keep an old
   writer away from a newer file; and only then
4. enable the first producer that may write the new version.

An old writer must never downgrade, truncate, reinterpret, or overwrite a newer
file. Missing-file handling is not forward compatibility: falling back on
`ENOENT` may be valid, while treating an unknown version as empty state is not.
Capability gating is insufficient when another local binary can write the same
file without going through that capability.

Rollback disables new producers before removing new readers. A sidecar file or
dual writer is not a substitute for a deliberate migration unless the owning
contract explicitly requires it.

### Projects contract and local-store rollout

Projects changes both repository fingerprint identity and
`project-bindings.json`:

- The canonical fingerprint rule begins preserving explicit ports and
  lowercasing paths on GitHub, GitLab, and Bitbucket. This is a breaking
  dogfood cutover with no dual matcher. Re-edit every affected dogfood
  Project's Repository URL to recompute its fingerprint, then prove discovery
  matches it. Record the changed identity, remediation, and smoke evidence in
  the Contract Impact Audit.
- Ship CLI/Service readers for bindings v1, v2, and v3 before any v3 write.
  A newer unknown version returns `project_bindings.update_required`, and the
  existing same-machine update-required version gate must be active before the
  capability-gated v3 producer. Retire the misleading `binding store is
invalid` message for a newer-version file.
- The Project HTTP route cuts directly from
  `/v1/organizations/current/agent-activity/projects` to
  `/v1/organizations/current/projects` without an alias. Unlike an old local
  writer, an old HTTP caller fails visibly with 404 instead of corrupting data.
  Release notes and the Contract Impact Audit must state that old
  `openmeld projects` commands require a CLI update.
- Project authority narrows existing behavior: admins can no longer remove
  Projects. The release note must call out that permission change explicitly;
  it is not an internal refactor detail.

The local-file consumer-before-producer window and the HTTP hard cut are
different policies for different failure modes. Do not weaken either one to
make their rollout shapes look uniform.

### Agent Activity rollout and CLI release closure

Agent Activity adds D1 truth, strict cloud contracts, an OpenMeld Service
observer, managed provider integrations, a Remote Agent digest consumer, and a
published CLI surface. Keep its producer windows explicit:

1. Apply `0029_agent_activity_projects` before
   `0030_agent_activity_events`, then apply
   `0031_agent_activity_retention_indexes`. Never drop or rewrite these tables
   during rollback.
2. Deploy shared strict readers and a Remote Agent worker that accepts the
   digest RPC before Core can enable digest production. Keep
   `OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED=false` until the Core receiver is
   deployed, then enable it only for the final interactive Center Agent caller
   window. Configure
   `OPENMELD_AGENT_ACTIVITY_DIGEST_MODEL_ID` on that worker, then deploy Core,
   Gateway, API/Web consumers, and the local CLI/Service bundle.
3. Keep `OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED=false` until the consumer,
   model configuration, migrations, and Core scheduled path are all verified.
   Enabling it is a separate producer action; an empty or invalid model id must
   fail the digest explicitly rather than fall back to the interactive model.
4. Publish the CLI/Service bundle only from the same verified commit. Older
   cloud code returning 404 leaves the new local outbox retryable, and an older
   local component simply reports no Agent Activity; neither case may block
   Wake, setup, or Service lifecycle commands.
5. The Center Agent read tool uses the opposite dependency direction: deploy
   its Core private receiver before exposing the Remote Agent caller. A missing
   receiver is an unavailable read tool, never an empty successful snapshot.

Rollback first disables digest production and local reporting, then removes
Remote Agent callers before Core receivers and clients before Gateway routes.
Retained events, digests, and aggregates expire under normal retention; do not
edit them into a rollback state.

### Agent Task Coordination rollout and CLI release closure

Agent Task Coordination adds strict shared task schemas, Core D1 coordination,
private Center Agent tools, Runtime Reporting callbacks, a Local OpenMeld
Service outbox, and managed Codex/Claude Code Hook artifacts. Keep the receiver,
storage, and local-producer windows explicit:

1. Apply D1 migrations `0051_motionless_firestar`,
   `0052_sudden_captain_universe`, `0053_last_power_pack`, and
   `0054_dusty_roulette` in order before Core accepts controller-task callbacks,
   discovery, scheduled retention, or durable delegated-Wake publication.
   Rollback disables producers and readers; it does not drop or rewrite task
   registrations, lifecycle events, subscriptions, terminal projections, or
   Wake publication rows.
2. Deploy the shared schema and Remote Agent parser that accept
   `publicationStatus: pending` before Core can emit that additive response.
   An older Core continues to return the accepted legacy response shape, which
   the new consumer accepts. The Space rejection-tombstone table is an internal
   lazy Durable Object schema upgrade owned by the same Core deployment.
3. Deploy Core's Runtime Reporting receiver, task discovery/watch RPCs, and
   `actionSet=v10` audit reader before Gateway/API forwarding and before the
   Remote Agent exposes `openmeld_list_agent_tasks` or requests `v10`.
   Receiver-first deployment makes an old caller safe and a new caller fail
   closed against an old Core instead of fabricating task state.
4. Deploy the Gateway/API consumers after Core, then publish the local
   CLI/Service/managed Hook bundle. An old local component reports no controller
   callbacks; a new component retains callback rows with bounded backoff while
   the additive route is unavailable. Neither case may block ordinary setup,
   Wake, Stop, or Space publication.
5. Task discovery is a bounded one-shot read for resolving an exact handle.
   Agent turns must not poll it. A successful watch ends the current turn and
   resumes only through the Core-owned completion subscription.
6. The local Service carrier and managed Hook artifacts require the base-aware
   local-component stamp and `pnpm run verify:release-ready`. The current
   compatibility judgment is advisory `available`: existing Wake and setup
   contracts remain compatible, while the new callback capability remains
   unavailable until the local update. Promote a component to `required` only
   if a fresh Contract Impact Audit finds that old behavior can corrupt or
   misinterpret an existing contract.

Rollback removes Remote Agent callers before Core receivers, disables local
callback producers before withdrawing the Gateway/Core route, and preserves
the D1 ledgers for replay and diagnosis. Agent Task Coordination remains a
coordination projection throughout; RuntimeCoordinator, native delivery, and
controller-native providers keep execution authority.

### Execution Recovery and controlled-drain contract impact audit

Execution Recovery adds a strict public capability projection, two recovery
commands, nonterminal recovery notice variants, Runtime Transport drain and
exact-conversation frames, a Service capability bit, and one Agent Task
Coordination observation table. Roll it out consumer and storage first:

1. Apply D1 migration `0083_young_red_shift` before Core can persist
   interaction-needed observations or redrive their task continuations. Apply
   `0084_furry_blink` before Core admits hosted Native Delivery rows with their
   frozen controller-normalization snapshot. Apply
   `0085_faulty_power_pack` before Core admits the immutable originating
   publication destination and Execution Recovery fields required by hosted
   recovery. Migrations `0083` through `0085` must all complete before the new
   Core writer is deployed. Rollback disables new writers and readers but does
   not drop or rewrite any of these durable evidence shapes.
2. Deploy Web's signal parser and recovery-action consumer, then Gateway's
   forwarding routes, before Core may emit
   `execution_recovery_available`/`execution_recovery_completed` or return the
   new strict recovery response. An older loaded Web asset may not understand
   the new notice enum, so keep this producer window short and require a reload
   rather than weakening or duplicating the notice contract.
3. Deploy Core's inspect/execute receivers and Runtime Transport frame parser
   before Remote Agent exposes the Center Agent recovery tools and before a
   local Service advertises `resumeControllerConversation`,
   `acceptingDispatches`, or a stop cause. A new caller against old Core fails
   closed; it must not synthesize recovery or treat 404 as no result.
4. Publish the CLI/Service component last. New Core accepts an old Service:
   durable outbox replay and ordinary Wake behavior continue, while controlled
   drain attribution and exact-conversation resume remain unavailable. Old
   Core is not a supported receiver for the new Service's strict capability,
   heartbeat, and recovery frames, so do not release the local producer first.
5. The CLI/Service paths require a base-aware local-component stamp and
   `pnpm run verify:release-ready`. The compatibility policy remains advisory
   `available` because old local components cannot corrupt Core recovery truth
   and continue existing Wake/setup/result behavior. Promote to `required`
   only if a later contract audit proves an old component can misinterpret or
   overwrite retained execution state.

Rollback disables or removes the new local producer first, then Remote Agent
callers, then Core producers, and only afterward Gateway/Web consumers. Pending
Service outbox rows, Core result inbox rows, recovery operation records,
RuntimeCoordinator history, and Agent Task observations stay durable for
replay; rollback must not rewrite them into a terminal success or a fresh Wake.

### Center Agent Routine rollout and CLI release closure

The W1, W2, W3, and W5 execution path is a strict cloud-contract rollout with
two opposite Remote Agent dependency directions. W4 also changes the published
OpenMeld CLI, so the integrated feature has a separate local-component release
closure. Keep these responsibilities and the two cloud windows separate:

1. Apply D1 migration `0025_center_agent_routines` before
   `0026_routine_scheduling_execution`, then apply
   `0028_routine_run_workflow` before enabling the Workflow engine. Migrations
   are forward-owned durable state; rollback must not drop the tables or rewrite
   Run history.
2. For W2, deploy a Remote Agent worker that accepts the strict Routine
   sender/trigger envelope before Core enables the minute scheduler producer.
   Old Core remains safe with that consumer. Old Remote Agent is not safe after
   Core emits the new strict variant.
3. For W5, deploy Core's six private Routine tool receiver methods before the
   final Remote Agent worker exposes the corresponding interactive callers. A
   missing receiver fails closed, but that is an unavailable product tool, not
   a safe completed rollout.
4. Deploy the Core Routine HTTP/RPC producer before Gateway routes, then Web and
   the published CLI consumers. Strict response mismatches must fail visibly;
   do not add an empty-list fallback or relaxed response parser to bridge the
   window.
5. When the signed Run `scheduledFor` and `beforeScheduledFor` contract ships,
   coordinate Core, Gateway, the shared API client, Web, the Remote Agent
   Center Agent tool consumer, and CLI in one release window. Existing
   nonnegative rows remain compatible, but an older strict parser rejects valid
   negative quarantine evidence. This coordination does not replace or reorder
   the W2 and W5 dependency windows above.

W2 and W5 may require separate Remote Agent releases or an explicit exposure
gate. A single worker artifact must not expose W5 callers while it is being
deployed early only to satisfy W2.

Rollback reverses each dependency: remove W5 callers before Core receivers;
remove Web/CLI consumers before Gateway routes when those routes are being
withdrawn; stop Core's Routine scheduler/emitter before rolling back the W2
worker consumer. Preserve the D1 definition and Run ledger throughout rollback.

Routine execution is Workflow-first. Keep
`OPENMELD_ROUTINE_ENGINE_DEFAULT=workflow` for normal local and production
operation. Use `OPENMELD_ROUTINE_ENGINE_DEFAULT=legacy` for an emergency global
rollback, or add Organization ids to the comma-separated
`OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS` list for a scoped rollback. Restart
Core after changing either value. The selection applies only to newly claimed
Runs: each Run freezes its engine at claim time and never crosses from Workflow
to legacy after Workflow ownership begins. Do not test rollback by editing
`routine_runs.execution_engine`; change the configuration, create a new
occurrence, and compare the new Run's D1 record, Workflow instance status,
native-delivery ledger, and single Space result.

Before removing the last production legacy override, prove one complete
user-visible Routine through Web or the published CLI and keep the following
operator views open for the validation window:

1. Cloudflare Workflow metrics for failed and terminated instances, failed step
   attempts, retry counts, and unusually long waits;
2. OpenMeld Analytics Engine events under
   `core.openmeld.routine_workflow.*`, correlated by `dispatchId = runId`;
3. the D1 Run and native-delivery ledger for that same Run id; and
4. the target Space, which must contain at most one final success or explicit
   failure result.

Alert or apply a legacy override for future Runs when an instance is
terminated, recovery is blocked, callback forwarding repeatedly fails, a
Workflow completes while its D1 Run remains nonterminal, one Run produces
multiple model admissions or Space results, or the Run/ledger/Workflow target
or identity evidence diverges.
Do not page on ordinary `waiting` instances or a single platform-managed step
retry. Cloudflare Event Subscriptions may later route native Workflow failure
events to an owned Queue or HTTPS consumer, but that resource is not part of
the current implementation until its binding, consumer, generated types, owner
docs, and deployment gate are added together.

For blocked recovery, inspect the instance with the supported Wrangler Workflow
instance commands and correlate it with the D1 Run before acting. Restart only
from the named failed step when that phase is known safe. Never recover by
editing Run rows, changing `executionEngine`, or blindly restarting an unknown
or terminated instance from the beginning.

Before rolling Core back to a version without Workflow callback routing, first
restore the legacy default and wait for every already claimed Workflow-owned
Run to become terminal. The default prevents new Workflow Runs; it does not
move an in-flight Run to legacy execution.

The W1, W2, W3, and W5 cloud boundaries do not change workstation OpenMeld
Service, daemon, or RuntimeCoordinator contracts and do not by themselves
require a workstation hard cut. Do not stamp a local component solely because
those cloud packages were rebuilt into an artifact.

W4 is different because it changes `clients/openmeld-cli`. On the branch that
actually publishes the integrated feature:

1. bump the CLI package version and any coupled OpenMeld Service bundle version
   required by the current release tooling and bundle contract;
2. run the base-aware `pnpm release:local-components stamp ...` command with an
   explicit policy; it rebuilds the packaged CLI and verifies what it writes;
3. run `pnpm run verify:release-ready`; and
4. publish through `pnpm run release:cli --with-binary` so the package,
   binary channel, tag, manifest projection, and production Core come from the
   same commit.

Compatibility review currently supports an advisory `available` policy for
the CLI and any restamped Service bundle because existing setup and Wake work
can continue without the new Routine commands. The final release card must
reconfirm and record that policy; only an incompatibility found there may
promote it to `required`. Do not bump versions or stamp the manifest on a
feature/docs branch that will not publish.

## Desktop Preview Release Workflow

The current Desktop preview release is a production Web download plus a private
R2 artifact:

1. Build the unsigned Apple silicon DMG:

```text
pnpm run release:desktop-preview:build
```

2. Upload the production artifact to R2:

```text
pnpm run release:desktop-preview:upload
```

The upload command uses the bucket `openmeld-desktop-downloads` unless
`OPENMELD_DESKTOP_R2_BUCKET` overrides it. It uploads:

- `desktop/OpenMeld-Desktop-<version>-macos-arm64-unsigned.dmg`
- `desktop/update.json`

`desktop/update.json` is the Desktop preview release metadata source. Production
Web reads this R2 projection for `/desktop/update.json` and for the
`/desktop/download` artifact object key. Do not duplicate the preview version or
artifact key in Web checked-in constants.

3. Deploy Web through the guarded deploy entrypoint after Web code or Worker
   bindings changed:

```text
pnpm run deploy
```

The user-facing download URL is `https://openmeld.ai/desktop/download`. Production Web
streams the DMG through the `OPENMELD_DESKTOP_DOWNLOADS` R2 binding; do not make the
bucket public or switch to an `r2.dev` URL for the production download page.

If `pnpm run release:desktop-preview:upload` fails with a long-running Wrangler
`fetch failed`, treat it as a network/upload blocker. Do not deploy the Web
download page as release-ready until the R2 bucket reports the DMG object and a
download round trip matches the build SHA-256. Use a more stable network or an
R2 S3-compatible Object Read & Write token with multipart-capable tooling; R2
S3 credentials are secrets and must not be committed or left in shell history.

Validation floor for this workflow:

```text
pnpm -C clients/desktop check
pnpm -C clients/desktop test
pnpm -C clients/desktop build
pnpm -C clients/web check
pnpm -C clients/web test
node --test scripts/release/desktop-preview.test.mjs
pnpm run verify:cloudflare:env-contract
pnpm run release:desktop-preview:build
```

Real-user smoke must still happen on a Mac through the installed app, not only
through the package build output.

## Local Components Release Tool

Use the local components release tool before publishing a CLI release or
deploying a hard-cut local setup change.

The tool keeps release-side intent for three local components in one tracked
manifest:

- OpenMeld CLI command contract
- OpenMeld Service bundle and execution contract
- OpenMeld-managed skills

Inspect the checked-in policy and the existing local build artifacts:

```text
pnpm release:local-components:status
```

`status` is diagnostic only. Its Service hash comes from the existing local CLI
`dist`, which may predate the current source. Do not copy that hash into the
manifest or treat status output as release-ready evidence.

Use the safe, base-aware stamp command when preparing a publish or deploy:

```text
pnpm release:local-components stamp --next --cli required --service required --skills required --reason "Hard-cut local setup after the Service Thin Core refactor."
```

The command snapshots the current source, rebuilds the packaged CLI from the
workspace, stops if the source changes during the build, writes the manifest,
and verifies the final result. If final verification fails, it restores only
the files it wrote and never overwrites a concurrent edit. Do not hand-edit
bundle hashes, run a separate build after stamping, or pass `--current` to a
stamp command. After a merge, rebase, or later local-component change, rerun the
same stamp command against the final source before committing.

`--next` reads npm `latest` and the R2 stable CLI manifest, selects the higher
stable version, and increments its patch. It prints both channel facts and warns
when they drift. Missing network, credentials, or valid channel versions fail
closed without writing a guessed version. `--version X.Y.Z` remains the explicit
operator-approved mode; it skips channel reads and is mutually exclusive with
`--next`. `release:preflight` uses the same version decision function.

CLI version bumps and manifest re-stamps belong to the release that actually
publishes from `main`. Do not bump the CLI version or commit a release manifest
re-stamp from a feature branch: perform both in the clean release worktree, or
the repository records release state that never reached users.

PR CI and ordinary non-`main` branch pushes enforce that rule with the explicit
`verify:release-ready -- --defer-release --base <exact-base-sha>` mode. Deferred
verification still rebuilds the packaged CLI and Service facts and runs the
release-tool tests. It requires the CLI version and
`release/local-components.json` to remain identical to the base, then reports
source and hash changes as pending work for the final clean-`main` release. It
does not treat the base manifest hash as release truth for changed feature
source.

The final operator-approved release commit uses a versioned
`codex/release-X.Y.Z-<baseSHA>` branch. The version must match the CLI package
and local-components manifest, the SHA suffix must match the PR's exact base,
and the base diff must contain exactly `clients/openmeld-cli/package.json` and
`release/local-components.json`. That explicit, release-only branch shape
selects strict release-ready verification in both pre-push and PR CI, so the
stamped manifest can pass Fast PR before merging to PR-only `main`. The shared
release branch policy script owns this classification; ordinary feature
branches remain deferred and cannot carry a release stamp, while a malformed or
mixed-scope release branch fails closed.

The pre-push hook chooses deferred mode only when every pushed destination is an
ordinary non-`main` branch. It parses Git's pushed-ref lines; a push that
includes `refs/heads/main`, a versioned release branch, a tag, malformed input,
or no input stays strict. Ordinary PR CI passes the pull request's exact base
SHA explicitly, while versioned release PRs run the same strict gate used by
main. Because local verification uses the checked-out worktree, the hook rejects
any non-deletion pushed object that does not resolve to the checked-out `HEAD`
commit and rejects uncommitted changes to release-relevant paths,
`.husky/pre-push`, the root `package.json`, or any file under
`scripts/release/`. This ensures the verifier builds and reads the exact
release-sensitive tree using the exact gate logic being pushed while allowing
unrelated worktree changes. Main post-merge guards, release preflight, publish,
Core deploy, and every actual release path remain strict.
During a deliberately batched merge sequence, temporary commits on `main` may
therefore show the strict local-component guard red until the approved clean
release worktree stamps the combined source. The final release commit must
restore that guard to green; main is never auto-deferred.

For an advisory local update that should show as available without blocking
Wake:

```text
pnpm release:local-components stamp --next --cli available --service available --skills available
```

Verify the tracked manifest against a freshly rebuilt package, Service bundle,
skill bundle, and changed paths with the release-ready gate. The base resolves
in this order: an explicit `--base`, then `OPENMELD_AFFECTED_BASE` when set, then
the most recent `v*` release tag reachable from HEAD (created locally and
published to `origin` automatically by `pnpm run release:cli`; it marks the last
actually-published state), and only then `origin/main` as the pre-tagging
fallback. Do not treat `origin/main` as the published baseline — in a
batched-push workflow it can lag arbitrarily far behind the last npm publish:

```text
pnpm run verify:release-ready
```

Use a current-facts-only check only when no base ref is available. Keep it on
the release-ready entrypoint so the CLI is rebuilt first:

```text
pnpm run verify:release-ready -- --current
```

Current early-release policy:

- Any CLI, Service carrier, or Skills artifact change must be stamped as
  `available` or `required`.
- Service bundle changes can be advisory unless the Service runtime contract
  changes.
- Skills bundle changes can be advisory unless the skills contract changes.
- CLI package updates can stay advisory unless the CLI command contract changes.
- `available` means a newer local component is available and current Wake work
  can continue. `required` is the only release policy that blocks the affected
  capability.

Skills stamping is release-side artifact intent, not a user-store repair step.
Stamp skills only when checked-in OpenMeld-managed skills under
`clients/openmeld-cli/skills` change, or when the skills contract/policy changes.
Running `openmeld skills update` or `npx -y openmeld@latest skills update` only
updates the user's local skills store such as `~/.openmeld/skills`; it does not
update `release/local-components.json` and does not replace the running OpenMeld
Service bundle. A real skills artifact release must stamp `--skills available`
or `--skills required`, commit the manifest, pass `pnpm run verify:release-ready`,
publish/deploy through the guarded entrypoint, and deploy Core so production
reads the same manifest.

This tool is release workflow, not product authority. Runtime readiness,
Service health, Space truth, and Wake execution truth remain owned by their
normal contracts.

## Database Workflow

Run shared D1 workflow commands from the repo root through the `pnpm db:*`
command family.

Use these commands for shared database workflow: check, inspect, generate,
migrate, verify, optimize, sync, and studio.

Use `pnpm run db:release:prod` as the only production implementation
entrypoint. `pnpm db:sync:prod` is an alias to it. It owns generation-drift
failure, remote migration preflight and apply, physical-contract verification,
and one final `PRAGMA optimize`. Component-only deploys do not run it.

Production selection and recovery rules belong in
`developing/engineering/production-release.md`. Migration history safety
belongs in `packages/db/drizzle/README.md`.

These are workflow entry points, not data ownership truth.

Data ownership, projections, Dispatch Ledger, Diagnostic Reports, and
observability boundaries belong in
`developing/architecture/data-and-observability.md`.

## Fresh Web Start

Fresh Web Start is a local product-path validation tool for:

```text
same machine
same installed local tools
fresh OpenMeld product state for one local test account
```

Use it for first-time Web setup, setup handoff, account/device alignment,
Prepare Session behavior, or local product data cleanup validation.

Fresh Web Start may create a temporary `OPENMELD_HOME` and align Web dev command
generation with that home. It must not become a production shortcut, hidden
state bypass, or replacement for user-operable validation.

The browser, login path, Web setup entry, CLI handoff, OpenMeld Service behavior, and
final visible outcome still need to be validated through the user-visible path
that matches the change.

## Repair, Reset, And Login

Repair, reset, and login are lane-sensitive workflows.

Prefer repair before reset. Reset is last-resort destructive behavior for the
active lane only.

Repair and reset output must identify the active lane and effective `OPENMELD_HOME`.

Login validation must use the real login path for the lane and environment under
test. One-time tokens are short-lived and single-use. Use a fresh token for each
lane and environment.

Environment mismatch must fail clearly. Do not mix local Auth with a production
Gateway or treat that mismatch as a generic sign-in failure.

## Handoff Evidence

Validation handoff should include:

- user-facing entry point tested
- lane used
- effective `OPENMELD_HOME` when local state matters
- technical checks run
- user-operable smoke path used
- whether internal diagnostics were used
- whether fresh user, stale state, and retry paths were covered when relevant
- trace or Diagnostic Report pointers when relevant
- remaining user-visible or agent-visible gaps

Do not mark a user-facing flow as passed if only internal service calls,
hand-built API requests, seeded state, or direct DB/projection edits were tested.

## Owner Boundaries

Use the scoped owner documents for truth boundaries:

- `developing/product/product-model.md`: product promise.
- `developing/architecture/agent-transport-contract.md`: readiness, execution,
  and final outcome.
- `developing/architecture/local-openmeld-service.md`: OpenMeld Service and local trust
  boundary.
- `developing/architecture/data-and-observability.md`: data, trace, diagnostics,
  and sensitive-data rules.
- `developing/clients/cli.md`: CLI client responsibility boundary.
- `developing/clients/web.md`: Web client responsibility boundary.

## Engineering Invariants

- Tracked docs are English.
- `dev-tmp/` is local-only temporary material.
- Workflow proves owner-document truth; it does not redefine it.
- `~/.openmeld` is protected production user state.
- Destructive validation requires a temporary `OPENMELD_HOME` or non-production lane.
- Real-user smoke uses user-accessible entry points.
- Internal DB/API/DO/Queue access is diagnostics, not smoke validation.
- Affected, pre-push, and PR gates must match the touched scope.
- Evidence for readiness, Binding, routability, claim, execution, and trace must
  refer to the same object.
- Root database commands are workflow entry points, not data ownership truth.
- Fresh Web Start is a local validation tool, not a production bypass.
- Repair comes before reset; reset is lane-scoped and last resort.
