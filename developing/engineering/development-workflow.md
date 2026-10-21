# Development Workflow

## Agent Context

- Purpose: Define durable OpenMeld engineering workflow rules for parallel-agent
  ownership, local development, test selection, lane safety,
  database workflow entry points, cross-version rollout discipline, and handoff
  expectations.
- Read this when: You are coordinating parallel agent work, continuing an
  unattended task, choosing validation scope, using local CLI lanes, touching
  tests or service state, running affected/pre-push/PR checks, preparing
  real-user smoke evidence, changing a versioned local file, using Fresh Web
  Start, or changing workflow commands.
- Update this when: Parallel-agent ownership, unattended execution discipline,
  development lanes, test isolation, local validation commands,
  database workflow entry points, or handoff evidence requirements change.
- Do not use this for: Product semantics, architecture ownership, client
  responsibility boundaries, daemon internals, command tutorials, release
  checklists, or raw command-output archives.
- Source of truth: This file owns local engineering workflow boundaries. The
  end-to-end candidate, merge, release, health, smoke, evidence, and recovery
  lifecycle is owned by `agent-native-delivery.md`.

## Storage and migration references

Production shared relational storage is PostgreSQL. Numeric migration references
from the original D1 rollout describe historical schema dependencies already
absorbed into the native baseline; they are not D1 commands to run now. New
changes use the native journal and scoped database release in the
[PostgreSQL workflow](postgresql.md). Receiver-first service and client compatibility requirements still apply.

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
- A CodeGraph index is generated state tied to one checkout. Use it when the
  current worktree already has a usable index. When it does not, use `rg` and
  targeted source reads for bounded work; run `codegraph init` only when deeper
  structural or call-path analysis makes the per-worktree indexing cost useful.
  Never symlink or reuse another worktree's index because its paths and source
  state may differ.
- Production migrations, publication, and deployment run only from a dedicated
  clean release worktree at the exact approved `main` commit.

### Parallelism Discipline

- One pull request, branch, or production scope has one execution owner.
  Non-owners do not touch its labels, candidate runs, commits, merge, release,
  or smoke. Default to silence unless a newly observed conflict changes that
  owner's next safe action; follow the quiet-ownership contract in
  `agent-native-delivery.md`.
- Before editing, every agent lane declares its planned file surface and checks
  it against every in-flight lane. An intersection requires one explicit owner
  or an agreed sequence before either lane edits the overlap; a newly discovered
  intersection stops only the overlapping work until ownership is resolved.
- Resolve concurrent changes to shared registry-style files, including existing
  schema export entrypoints, `packages/db/postgresql/migrations/meta/_journal.json`, and
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
  entry count and run the shared migration-history integrity test.

### OpenMeld Development Collaboration

OpenMeld is an available collaboration surface, not a required hop in every
development loop. The responsible agent decides whether a Space, a native
environment callback, or no coordination best fits the actual work.

- Create or reuse a focused Space when one coherent feature, incident, release,
  or cross-environment handoff genuinely benefits from shared durable context.
  Name internal development Spaces `[OpenMeld Dev] <Feature, Incident, or
  Release>`. The prefix identifies the purpose; it does not create a special
  Space kind or a central coordination room.
- Keep one Space aligned to one real work context. Start a separate Space when
  the goal, participants, or relevant context changes materially, and stop
  reusing a completed Space for unrelated work.
- Keep an independent local development loop in its native environment when no
  shared context or handoff is needed. A short Codex App callback, OpenCode
  result, PR comment, or other authorized environment transport may be the
  clearest path for a one-off fact.
- Use `openmeld space add-me` when the agent should remain a resumable,
  Wake-capable participant. For a one-off dependency, SHA, handoff, or outcome,
  use the public CLI with an authorized Human Profile and state the reporting
  agent, model, and session or thread ID when available.
- Wake an Agent Profile only when the message assigns that Agent one concrete
  next action. Ordinary evidence and status facts can be sent without Wake.
  The Center Agent can summarize or connect organization context when that adds
  value; it is not a merge authority or a required relay.
- Use [Agent Experience Feedback](agent-native-delivery.md#agent-experience-feedback)
  for confirmed current-origin product problems that need another owner.
  Follow its evidence, repair-status, and ownership checks before posting,
  including its rules for fixed problems and new evidence. Keep problems you
  plan to fix, repairs owned by others, uncertain symptoms, and internal
  development or validation findings in the owning task, PR, or issue.
  For ordinary development coordination, an authorized native fallback may
  keep delivery moving. When Wake itself is the product behavior under smoke,
  only the visible product path proves success.

### Delivery Pipeline

- Follow `developing/engineering/agent-native-delivery.md` from final-candidate
  validation through merge, release, health, smoke, and evidence. This document
  owns the local lanes and test-selection details used inside that lifecycle.
- Release with `pnpm run deploy` from
  `developing/engineering/production-release.md`; `--dry-run` prints the plan
  without deploying.
- Hotfixes use the same command. Choose focused development checks by risk.
- `main` is PR-only. Every change passes the exact Final Candidate contract
  and merges through a PR before its `main` commit becomes a release
  source.

### TypeScript compiler and tooling API

The root `@typescript/native` dependency installs TypeScript 7's `tsc` binary.
Workspace `typecheck` and `tsc` build commands use that binary. The `typescript`
dependency is an npm alias for Microsoft's `@typescript/typescript6` compatibility
package, so tools that import the legacy JavaScript compiler API keep working.
It exposes `tsc6`, not `tsc`; do not replace workspace type checks with `tsc6`.
Repository-owned AST and transpilation scripts import `@typescript/typescript6`
explicitly and declare it in their owning package.

The compatibility wrapper's version is not the underlying compiler API version:
`@typescript/typescript6@6.0.2` currently resolves its `@typescript/old` dependency
to TypeScript 6.0.3 in the lockfile. Use frozen installs to preserve that resolution.
tsdown's declaration plugin also uses this API; bundled declarations remain on
TypeScript 6 while workspace checks and direct `tsc` emission use TypeScript 7.
The tsdown 0.23 migration includes Rolldown 1.2 and its declaration plugin, so
bundle chunk names and counts can change even when public imports stay the same.

Use `pnpm exec tsc --version` to check the active compiler. Reading the version
from `typescript/package.json` reports the compatibility API package instead.
Keep emitting projects' `rootDir` explicit to preserve package entrypoints.
Path aliases are relative to their config file; do not reintroduce `baseUrl`.
The supported build tools and compiler versions are pinned in package manifests
and the lockfile. Follow Microsoft's
[side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
when changing this boundary.

### Resource Discipline

For a new worktree, use Node from `.nvmrc`, pnpm from `packageManager`, and
`pnpm install --frozen-lockfile`. Run `pnpm dev:doctor`, then
`pnpm dev:postgresql` to start the complete Web/Worker stack. Use the
printed lane-specific URL. Docker is needed only for
`pnpm dev:worktree:sandbox`. `pnpm check` checks installed dependencies; it no
longer installs them implicitly. Install again after a lockfile change.

The isolated launchers reserve local capacity before starting processes.
Worktrees of the same Git checkout share the registry in the Git common
directory; separate clones do not. Reading and editing code needs no slot.
Root `build`, `check`, `test`, `test:integration`, `test:runtime`, and affected
validation commands share one broad-work slot by default. Nested commands
inherit their live ancestor's reservation instead of waiting on themselves.
When a nested build needs a larger heavy-work budget, the resource owner
rechecks current memory, OS pressure and competing reservations under the
registry lock, then expands the same reservation. The ancestor retains ownership
and the larger budget until it exits. Expansion fails immediately when capacity
is unavailable; it never waits while holding the ancestor's slot or silently
starts under an undersized reservation. Stack and Web startup budgets retain
their existing fixed reservation rules.
For another expensive local command, use `pnpm dev:run -- <command> [args]`.
Direct package commands, `dev:raw`, and the legacy fixed-port server bypass
this admission policy. Keep those focused and inspect machine facts first.
Hosted GitHub jobs retain their independent runner limits.

Startup budgets are estimates: 6 GiB for a Worker stack, 2 GiB for Web and
2 GiB for broad verification. Admission keeps 10% of effective memory on macOS,
where critical OS memory pressure blocks new work. Other platforms keep 15%; all platforms keep at least 1 GiB and
account for reservations that have not yet materialized as resident memory.
These checks reduce overlapping peaks; they are not OS-enforced memory caps and
cannot prevent another application from growing.

On macOS, warning pressure is distinct from critical pressure. Broad builds
still wait for normal pressure. Worker and Web starts, plus Desktop starts with
a reusable prepared bundle, may proceed at warning only after 30 continuous
seconds without an increase in `vm_stat` swapouts, and only if the unchanged
memory budget fits. Missing counters,
counter resets, critical pressure, or a sampling gap over five seconds restart
the observation. The 30-second window is a conservative local policy, not an
Apple capacity guarantee; a quiet swap counter does not mean RAM is unused.
The existing shared registry serializes admission: a starting Worker stack must
report ready, and at least 30 seconds must pass after the preceding live
reservation before more work starts at warning. Each next component samples
again; worsening pressure pauses subsequent admission, never kills running work.
Normal-pressure behavior and Windows/Linux budget checks are unchanged.

Pressure levels follow [Apple's memory-pressure notifications](https://github.com/apple-oss-distributions/xnu/blob/main/doc/vm/memorystatus_notify.md).
Use current swap activity rather than the historical amount of swap in use;
[Activity Monitor](https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac)
also considers swap rate when describing pressure. Waiting output identifies
the pressure level, observation/readiness condition and memory budget.

After the Worker stack's existing readiness probes pass, its reservation keeps
growth room of 25% of current process-tree RSS (at least 1 GiB), instead of
reserving the unused startup budget indefinitely. Machine headroom and OS
pressure checks still apply. Unready or older stacks retain the full startup
budget; missing process metrics do not release it. Web retains its startup
budget because compilation is request-driven. Restart owned environments with
the updated launchers to benefit; never rewrite another task's reservation.
Waiting messages show available memory, machine headroom, new startup budget,
and existing growth reservations separately.

Desktop development uses the same resource registry, not a second scheduler.
`pnpm desktop:dev` reserves heavy capacity only while preparing the native build,
then releases it and reserves the `desktop` memory class (default 1 GiB) for the
GUI. Actual process RSS is included in the machine snapshot. The existing pressure
and headroom guards still apply; `OPENMELD_LOCAL_DESKTOP_GIB` is an explicit measured
workload tuning option, not a way to make memory appear free. Run `desktop:doctor`,
`desktop:status` or `desktop:stop` in the owning worktree. See
[Desktop development lanes](../clients/desktop.md#development-lanes) for the complete
command contract. Repeated starts do not duplicate a GUI or rebuild underneath it.

`pnpm dev:status` reports process trees, summed RSS and machine memory
separately from disk space. RSS can count shared pages more than once. macOS
memory availability includes free, inactive and speculative pages and is
explicitly an estimate; Node's free-page count alone is insufficient there.
New lane records include process start identities. Older running lanes without
those identities can only be attributed through recognizable commands and
their descendants; restarting them through the current entrypoint improves
ownership evidence. Do not infer ownership from a PID or port alone.

When capacity is unavailable, the command prints the reason and registered
owners, waits without starting workers, and can be cancelled with Ctrl+C.
Stop an environment you own and no longer need, or wait for its owner to finish;
do not kill another agent's processes. For measured workloads on another
machine, explicitly configure `OPENMELD_LOCAL_HEAVY_SLOTS` (positive integer),
`OPENMELD_LOCAL_MEMORY_HEADROOM_GIB`, `OPENMELD_LOCAL_STACK_GIB`,
`OPENMELD_LOCAL_WEB_GIB`, or `OPENMELD_LOCAL_HEAVY_GIB` (positive numbers).
Keep limits consistent between terminals. Increasing slots does not increase
available memory. Existing processes are never terminated to admit new work.

Each isolated environment owns its descendant cleanup. Ctrl+C and
`pnpm dev:stop` request graceful exit, verify process identities, and reclaim
remaining owned descendants. Start, failure and cancellation must release
their resource reservations. Hard-killing an owner cannot execute its cleanup;
inspect and stop confirmed worktree leftovers before starting again. Preserve
lane-specific secrets, state directories and `OPENMELD_HOME` across this work.

Registry recovery uses Node 24's built-in SQLite OS lock at the permanent
`<registry>.lock.reclaim` file. A process exit releases the OS lock; the file
itself is not a stale lock and must not be removed while worktrees are running.
Registry JSON and live-owner PID checks remain unchanged. Older worktrees can
still acquire a free registry lock, but need the updated recovery code to reclaim
a dead owner after this file exists.

An old `.reclaim` **directory** has no owner identity. Startup waits for it and
reports its exact path on timeout instead of deleting a possibly active guard.
Before removing an old empty directory, verify the originating development
processes have exited; age alone and the main lock's PID do not prove that its
recovery process has exited. Do not reset the registry or stop unrelated lanes.

Run `pnpm verify:dev-lifecycle` after changing these contracts. The narrow
`Dev lifecycle` PR workflow exercises disposable subprocess trees on macOS,
Linux and Windows without installing dependencies or starting cloud services.
It supplements normal Final Candidate certification. Full OpenMeld startup,
hot reload and two-lane isolation still require a real development smoke.

- A background command attached to Codex must redirect standard input explicitly
  with `< /dev/null` so it cannot wait on the agent session.
- Before starting a heavy local fallback, handing off a worktree, or leaving a
  localhost stack unattended, inspect bounded machine facts with
  `pnpm dev:status`. It groups active processes by exact worktree instead of
  dumping every process into agent context.
- When this worktree no longer needs its localhost stack, preview its exact
  owned processes with `pnpm dev:stop -- --dry-run`, then run `pnpm dev:stop`.
  The command is worktree-scoped. Never stop another worktree merely to create
  headroom; contact its owner only when measured pressure blocks useful work.
- `pnpm dev:stop` also stops the worktree's isolated OpenMeld Service and
  removes its maintenance worker registration. It preserves account data and
  source files. Stop succeeds only after owned processes exit; failures keep
  the environment available for diagnosis. Resume local Agent validation through
  the same lane's setup/start entry, which restores maintenance registration.
- Use `pnpm dev:clean -- --dry-run`, then `pnpm dev:clean` to retire an isolated
  environment: uninstall its Service and maintenance worker, stop its dev stack,
  then remove only its isolated OpenMeld home and Wrangler data. Do not remove
  directories while a supervisor or owned execution can still use them.
  Before stopping or deleting anything, cleanup refuses registered worktrees
  within a disposable lane directory. Parent worktree removal also refuses any
  registered descendant, including ignored directories. Resolve each child's
  ownership separately; cleanup never removes or archives it on the parent's behalf.
- After merge and completion of acceptance/release dependencies, remove a
  task-created temporary worktree from a retained checkout with
  `pnpm dev:clean -- --worktree /absolute/worktree/path --remove-worktree`.
  This is authorized task closeout for that agent's own temporary environment;
  it does not authorize deleting pre-existing or another task's worktree.
  The command refuses primary, main, locked, dirty, unmerged, or in-use
  worktrees and never forces Git removal or deletes branches. The caller must
  also establish that no review, task, acceptance, or release still needs it.
  Process-directory verification must be supported on the current platform;
  otherwise preserve the stopped worktree and report the limitation.
- Stop resources as soon as they are no longer needed, including while a PR
  waits for review. A handoff requiring a live localhost environment must name
  its URL, owner, reason for retention, and cleanup responsibility. Closeout
  reports whether the environment was stopped, cleaned, removed, or retained
  for a concrete dependency. Inactivity alone never authorizes deletion.
- Do not ask unrelated agents to freeze `main` while one Final Candidate runs.
  A successful exact PR candidate keeps its immutable evidence. Merge queue owns
  the latest-main combination when available; strict up-to-date protection owns
  it otherwise. Agents should inspect those facts and choose their next action
  without CI/CD making a business or review decision for them.
- For a coordinated delivery train, integrate compatible ready leaf branches
  into one batch PR, sync `main` once, and run one Final Candidate on that
  combined tree. Leaf work keeps focused evidence; it does not need a separate
  paid candidate that will be invalidated by the same train.

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

The persistent Cloudflare staging environment is not a fourth local CLI lane.
It is a remote internal environment deployed with `pnpm staging:deploy`.
Staging Computer Setup uses the Canary binary, Canary OS-service identity,
and `~/.openmeld-canary`, with the Staging CLI manifest as its update source.
Use `pnpm staging:smoke:computer -- plan` and the official Staging Setup
runner documented in `developing/engineering/staging-environment.md`.
Do not substitute a Production binary with hand-written endpoint overrides.

## Local Worker Persistence

Use `pnpm dev:postgresql` for the current full local product. The Dev Supervisor
owns a PostgreSQL 18 cluster and aligned Web/Worker processes for this worktree.
Its synthetic relational data persists across normal stops; `pnpm dev:stop`
stops only that stack. See the [PostgreSQL workflow](postgresql.md#tools-and-local-development)
for connection injection, disposable clusters and D1 capture rehearsal.

Auth and Core use the same worktree PostgreSQL database. Durable Object SQLite,
R2 emulation and other Miniflare state retain the worktree's isolated Wrangler
persistence root. They are separate owners, not copies of relational tables.
Do not start package-local Workers against guessed state or connection paths.

`pnpm dev`, `pnpm dev:worktree`, and the explicit `pnpm dev:postgresql` alias
start the same PostgreSQL supervisor. Low-level isolated launchers also use
PostgreSQL. The historical D1 fixture scripts do not prepare a current product
database.
Do not repair current PostgreSQL startup by seeding a historical Miniflare D1
file or resetting another worktree's state. Use the current supervisor and the
native migration/acceptance owner; preserve the affected lane when diagnosing
startup failures.

## Parallel Worktree Dev Lanes

Use the standard commands for the primary fixed-port lane and the isolated
commands when multiple worktrees need live localhost stacks at the same time:

| Command | Use |
| --- | --- |
| `pnpm dev:doctor` | Check the shared Doppler development environment without printing values. Run this first on a new computer or when startup fails. |
| `pnpm dev:postgresql` | Preferred current-product command. Start the isolated PostgreSQL database, Web and Workers with shared Doppler values. Remote Agent Sandbox tools are disabled, so Docker is not required. |
| `pnpm dev:web:worktree` | Separate Web launcher when needed; `dev:postgresql` already starts Web. |
| `pnpm dev:seed` | Historical D1 fixture helper; does not support the PostgreSQL product lane. See [fixture scope](../../scripts/dev/sidebar-fixtures.md). |
| `pnpm dev:account` | Historical D1 account helper; use normal local product sign-up for PostgreSQL smoke. |
| `pnpm dev:worktree:sandbox` | Start the PostgreSQL Web/Worker stack with Remote Agent Sandbox tools enabled. Docker is required. |
| `pnpm dev` / `pnpm dev:worktree` | Start the current PostgreSQL product through the same isolated supervisor. |
| `pnpm dev:web` | Legacy fixed-port Web launcher; keep its Worker and database lane aligned. |
| `pnpm dev:isolated` | Low-level PostgreSQL isolated stack for checkouts that still use local environment files. |
| `pnpm dev:isolated:no-sandbox` | Low-level Docker-free PostgreSQL isolated stack for checkouts that still use local environment files. |
| `pnpm dev:isolated --test-scheduled` | PostgreSQL isolated stack that also prints its loopback-only Routine scheduler trigger. |
| `pnpm dev:web:isolated` | Legacy low-level Web attachment for checkouts that still use local environment files. |

For isolated Plugin acceptance, set `OPENMELD_DEV_PLUGIN_FIXTURE_URL` in the
same worktree lane to a compatible disposable provider simulator. The launcher
routes both Gateway and Remote Agent to that exact `http://127.0.0.1` origin,
with the non-secret `local-plugin-fixture` administration/runtime token in both
build/child environments and explicit Wrangler runtime overrides. A present but
empty, non-loopback or non-origin value stops startup; it never falls back to
production. An absent switch preserves ordinary approved development behavior.

The simulator must implement the API/runtime actions being tested; the switch
only isolates connector routing, not the model gateway or all external network
access. Check the running Gateway and Remote Agent settings before any Plugin
action, keep simulator state disposable and label simulated authorization as
such. This does not establish a real provider connection or replace approved
GitHub/Slack/Feishu/Lark resources for actual end-to-end acceptance.

For normal localhost development, start the complete product in this worktree:

```bash
pnpm dev:doctor
pnpm dev:postgresql
```

Use the normal local product UI for synthetic accounts and test data. Historical
D1 seed/account helpers do not support this PostgreSQL lane.

The first Web page load can take about one minute while Web and Cloudflare
compile. Keep the page open; later loads should be fast. This message is also
printed by the launcher so a newcomer does not mistake first compilation for a
failed start.

For real CLI/Service Setup smoke, run `pnpm cli:binary:serve:worktree` in the same
worktree and use the Web-generated lane command. This entry reserves heavy
capacity only for its build, signing, and archive preparation. It releases that
reservation before starting HTTP serving. Start it directly; wrapping the
long-lived server in `pnpm dev:run` retains the outer heavy reservation.
The CLI resolves its default
OAuth client from the active lane:
`dev-local` uses `openmeld-cli-dev`, matching the Web-issued grant; production
and canary use `openmeld-cli`. Explicit CLI/client environment overrides retain
precedence. The packaged binary and source entry use the same resolver.
On macOS, when testing real
Keychain access across CLI and Service copies, an already provisioned signing
identity can be selected with `OPENMELD_CLI_BINARY_DEV_SIGNING_IDENTITY`.
The binary server signs with the normal release entitlements, verifies the
signature, then computes the served checksum. Without this option it retains
the normal ad-hoc development build. This is local test packaging, not a release
or notarization; never replace production binaries or credentials to run it.
Ad-hoc signatures identify the exact build by its code hash. Copying identical
bytes into the Service carrier preserves that identity; rebuilding the binary
does not. A rebuilt ad-hoc CLI can therefore receive Keychain access denied
(`OSStatus -25293`) for a previous build's saved sign-in while that previous
build still works. This is not evidence that the account expired, nor a reason
to keep retrying. Use normal setup or login through the current packaged build
in the isolated lane to issue a new credential. Do not copy tokens, edit Keychain
ACLs, force private-file storage, or use release signing credentials to bypass
this boundary. If the lane's normal login entry is unavailable, retain the
existing login and report authentication smoke as blocked. Cross-version
credential continuity for a signed release requires a separate test with an
authorized stable signing identity; ad-hoc rebuilds cannot certify it.
The isolated Web launcher uses this worktree's reserved binary-server port.
It must never download another worktree's build from the shared fixed-port
server. Restart the binary server after changing CLI source; `dev:stop` includes
that server. `cli:binary:serve` without the worktree suffix remains the fixed-port
development entry only.

### Local macOS CLI/Service sign-in

The Device Authorization client defaults to `openmeld-cli-dev` in `dev-local`,
including when Web Setup launches the packaged binary instead of the
`openmeld-dev` entry. Explicit CLI and `OPENMELD_AUTH_CLIENT_ID` settings retain
their existing precedence. Production and canary defaults remain `openmeld-cli`.

New sign-ins automatically use the existing private-file token store when
`dev-local` has an explicit isolated `OPENMELD_HOME` and both Auth and Gateway
use loopback URLs. No extra setup flag is needed. Credentials are unencrypted,
protected by directory `0700` / file `0600` permissions; use test accounts only.
CLI rebuilds and Service restarts reuse the same login. Existing Keychain
sessions are not migrated: sign in normally once with the current build.

For real-Keychain acceptance, set `OPENMELD_DEV_CREDENTIAL_STORE=system` on the
setup/login command and use a separate fresh Home. Check that the saved
`tokenRef.provider` is `macos-keychain`; disabling the development mode does not
convert an existing file credential. Production, canary, remote endpoints,
default user-state directories and other operating systems retain their normal
storage behavior. This mode does not change provider credentials or permissions.

For a localhost Routine smoke, start the Worker stack with
`pnpm dev:postgresql -- --test-scheduled`, create an enabled Routine through Web,
then run the printed command to trigger one Core minute-scheduler tick:

```bash
curl -X POST "http://<lane-id>.localhost:<isolated-gateway-port>/__dev/routines/tick"
```

The route exists only when the Gateway is running with
`OPENMELD_WORKER_ENVIRONMENT=local` and Wrangler identifies a direct loopback
client. Forwarded tunnel traffic and deployed Workers receive `404`. Gateway
calls Core through the existing Service Binding, so Auth and Core keep their
normal single Wrangler process and one local PostgreSQL owner. The trigger runs the same
Core scheduler used by the minute Cron; it does not create or edit Routine or
Run rows itself.
Validate the resulting Run and final Space reply through Web; do not create or
edit Routine rows directly.

For a real Slack smoke, start the same stack with the current tunnel callback
instead of editing `wrangler.jsonc`:

```bash
OPENMELD_SLACK_OAUTH_REDIRECT_URL="https://<current-tunnel-host>/slack/oauth/callback" \
  pnpm dev:postgresql -- --test-scheduled
```

Configure that exact callback, plus `/slack/events` and `/slack/interactive`,
on the Dev Slack App. The tunnel must forward to the isolated Gateway port,
not the Web or Core port. Keep the tunnel URL ephemeral and out of tracked
configuration.

For a real Lark or Feishu registration and Webhook smoke, forward a public
HTTPS tunnel to that same isolated Gateway port, then start the stack with:

```bash
OPENMELD_DEV_PUBLIC_GATEWAY_ORIGIN="https://<current-tunnel-host>" \
  pnpm dev:worktree
```

The launcher writes this callback origin into the generated local Core config.
Browser routing, CORS, persistence, and Service discovery remain on the isolated
localhost lane. Use a development tenant and app; the provider must reach both
the event and card callback routes before the connection can become connected.
This setting does not change staging or production configuration.

A Git worktree does not copy ignored local secret files. The preferred shared
environment path is `pnpm dev:doctor`, followed by `pnpm dev:postgresql`. The runner supplies the same authorized Doppler `dev`
configs to every worktree without copying files. Legacy package-local
`.dev.vars` files remain supported by the low-level commands during the
migration, but the Doppler runner fails if one would shadow its process
environment. Secret ownership, safety, and onboarding are defined in
`developing/engineering/environment-and-secrets.md`.

The isolated stack commands print the lane ID, actual local URLs,
persistence root, and effective `OPENMELD_HOME`. Do not assume the fixed
3000/8080/8788/8790 ports in an isolated lane. Use the printed URLs.
`pnpm dev:web:worktree` fails closed unless the same worktree has a live
isolated Worker stack.

Each isolated worktree automatically uses `<lane-id>.localhost`, for example
`http://wt-a1b2c3d4e5f6.localhost:30176`. The lane ID comes from the worktree
path, so its hostname survives restarts without agent configuration, a hosts
file edit, or a shared DNS service. Web, Auth, Gateway, and Remote Agent use
the same hostname with their allocated ports. Use these printed URLs rather
than replacing the hostname with `localhost` or `127.0.0.1`: cookies are scoped
by hostname, not port, and plain localhost would share browser authentication
with other worktrees. Development auth cookies remain host-only; the Auth
launcher also sets the passkey relying-party ID to this worktree hostname.
Existing plain-localhost sessions and passkeys do not migrate to the new host;
sign in and register any test passkeys again in the isolated environment.
The fixed-port lane remains unchanged.

Web's local CLI guidance, setup bootstrap lane selection, and local activity
preview share one local-origin check, including `.localhost` subdomains. An
external hostname that merely contains `localhost` is not a local origin.

Third-party OAuth providers still require an allowed callback URL matching the
chosen development origin. Automatic local hostnames do not register callbacks
with GitHub, Google, or other providers. Use disposable local accounts for
parallel authentication smoke unless that provider's callback is configured.

Do not start or set up OpenMeld Service for a Web-only smoke that does not need
local Agent execution. When Service validation is required, diagnose ownership
through the lane-specific `openmeld service status` output. A machine-wide
`launchctl list` or process list can legitimately contain production and
dev-local Services at the same time and is not evidence of multiple owners in
one lane.

Agents should use `pnpm dev:postgresql` by default when the touched
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

- one stable `.localhost` hostname for browser authentication isolation
- public Web, Gateway, Auth, and Remote Agent ports
- Worker inspector ports
- one lane-specific Wrangler service registry, so local service bindings cannot
  connect to a Worker from another worktree
- one lane-specific Miniflare persistence root under
  `.wrangler-dev-state/isolated/<lane-id>/`
- one lane-specific `OPENMELD_HOME` under
  `.turbo/dev/isolated/<lane-id>/openmeld-home/`
- one Service and maintenance registration, lifecycle lock, and repair marker
  per development home. Their OS-safe suffix is derived from the absolute home
  already carried by setup and service registration; it does not depend on cwd,
  current port allocation, or a transient environment variable. Production and
  canary keep their fixed identities. Old unsuffixed development registrations
  are not automatically adopted or removed; retire them separately after
  identifying their owner and finishing its work.

Native Agent regression smoke must retain the working folder that produced
the failure. Keep the CLI, Service, account, and Desktop home aligned with the
registered lane. A successful run in another folder is comparison evidence,
not proof that the original failure is fixed. Native controllers can discover
parent repository configuration, so record the effective working folder and
selected controller version. Do not disable native policy checks or expand
filesystem permissions to make a smoke pass.

The shared lane registry lives under the repository's Git common directory so
all worktrees coordinate allocation. A live owner is never stopped or reclaimed.
The launcher reclaims a lane only after its recorded owner PID is dead, and it
skips a port block already owned by an unrelated process. Starting an isolated
lane does not bypass the normal Node, shared-DB migration, build, or readiness
guards.

Isolated PostgreSQL, Durable Object, and local OpenMeld state intentionally do not share
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
| `pnpm dev:desktop`              | Current registered worktree lane | Alias for `pnpm desktop:start:dev`. |
| `pnpm run desktop:dev`          | Current registered worktree lane | Builds and launches the Desktop pilot with the lane-local CLI and dev-local preset. |
| `pnpm run desktop:start:dev`    | Current registered worktree lane | Uses the existing lane CLI, home and endpoints; no global installation or production fallback. |
| `pnpm run desktop:canary`       | Current registered worktree lane | Alias for `pnpm desktop:start:canary`. |
| `pnpm run desktop:start:canary` | Current registered worktree lane | Uses the same guarded lane launcher with an explicit canary preset. |
| `pnpm desktop:package:private` | Build only | Packages the matching prebuilt pilot Web assets into a private unsigned macOS arm64 app/DMG; no Service or upload. |
| `pnpm desktop:start:package "/path/to/private.app" [canary]` | Current registered worktree lane | Launches that private app through the same CLI, endpoint and GUI-data guards without rebuilding it. |
| `pnpm run desktop:start:prod`   | `openmeld` / `~/.openmeld`               | Starts Electron against the published production lane for explicit production reproduction only.                                             |

These scripts align `OPENMELD_BIN`, `OPENMELD_ENV_PRESET`,
`OPENMELD_USER_FACING_CLI_COMMAND`, `OPENMELD_GATEWAY_URL`, `OPENMELD_AUTH_URL`, and
`WEB_APP_URL`. Do not validate Desktop lane behavior with a mixed CLI/Web/Auth
environment.

The pilot requires an existing Worker lane and the CLI installed through its
normal Web setup. Its launcher reuses `readCurrentIsolatedDevLane` and
`buildIsolatedDevEnvironment`; it does not maintain another port map or registry.
It requires `<OPENMELD_HOME>/bin/openmeld` to be executable and resolve within
the lane home. On macOS, the normal source and Private package pilot launchers
use Chromium's mock Keychain before authentication storage initializes and keep
its lower-protection test credentials under the stable lane-owned
`desktop/mock-keychain-user-data` directory. The first launch after switching to
this directory needs one test login; later builds and restarts reuse it. Do not
store production credentials in this test profile. Installed production,
staging, and disposable acceptance builds keep the real system Keychain. Use
`pnpm desktop:package:acceptance` for explicit real-Keychain acceptance.

Serve matching compiled Web assets with
`OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree`, then launch Desktop with
`pnpm desktop:start:dev`. The Web supervisor retains normal reservation,
Doppler, and cleanup ownership, but runs build plus Vite preview for this opt-in
mode. Preview binds loopback for TanStack shell prerender; configured account
and service endpoints retain the actual worktree hostname and ports. Stop the
owned old Web process before switching modes. A Vite dev server is not a matching
Desktop RPC registry. See [Desktop](../clients/desktop.md) for identity checks.
For private packaging, use this guarded Web build path rather than only setting
the pilot flag on a package-local build. The client requires the lane's compiled
`VITE_BETTER_AUTH_URL`; pilot builds reject missing or invalid values after Vite
loads its environment. The native launch environment cannot supply that value
retroactively to an already built renderer.

The same worktree producer declares `VITE_OPENMELD_SETUP_USER_FACING_COMMAND`,
`VITE_OPENMELD_DEV_LANE_ID`, the public Auth/Gateway/Web endpoints, isolated Home,
and the client/server CLI manifest. The compiled renderer and installer must
agree on that target. Missing or conflicting isolation fields fail closed;
production-mode compilation is never permission to select the published lane.
The unnamed Wrangler environment declares local development, `stg` declares
Canary, and `prod` (including an installed production Desktop target) declares
the published lane. Build-time public command endpoints are projected from the
selected existing Web Wrangler vars, not a second environment registry.

All dynamic Web setup, repair, login, start/stop, Space join, Skill guidance and
Agent-prompt command prefixes use `resolveWebCliTarget`. Follow-up commands keep
the isolated Home and endpoints. After installation, `setup.complete` remains
the authority for the installed command; this build target does not invent an
installed binary path or certify clean-install acceptance.

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

An independent `OPENMELD_HOME` isolates files, not every operating-system or
remote resource. Service smoke must also align the CLI entry, environment
preset, system-service identity, endpoints, and update manifest through the
official development or Canary entry point. A Production executable with a
temporary home is not the supported isolated Service smoke entry point.

Fixture identities must stay inside isolated test stores.

Managed agent skills directories (`~/.claude/skills` and the other registry
defaults) are shared real-user state owned by the published `~/.openmeld` lane.
The CLI enforces this: with a lane-specific OpenMeld home (`openmeld-dev`,
`openmeld-canary`, or any `OPENMELD_HOME` override), OpenMeld-managed skills
detection, tracking, install, and readiness skip the registry-default agent
directories, and
`skills ensure --all` is a safe no-op there so setup completes inside dev
lanes. Lane-local skills validation must use explicit targets (`--dir`, config
custom targets, or per-agent `globalSkillsDir` overrides). A lane that links a
shared agent directory at its own skills store hijacks the published install
and leaves a dangling link when the lane is deleted.

This skills-directory boundary does not hide installed local Agent Controllers.
`openmeld agents detect`, setup, and Prepare may still read-only probe a
runtime-supported controller and keep its launch contract inside the isolated
lane. Detecting Codex in a dev lane does not authorize that lane to manage
Codex's registry-default skills directory.

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

Treat broad affected, integration, release-ready, and repository-wide commands
as heavy closeout work when they fan out across packages. While implementation
or practical blocker review is still changing the tree, stay on focused tests
and the smallest real smoke that answers the current question. If a broad run
is needed early to diagnose an uncertain cross-boundary failure, run only that
boundary and do not describe it as final evidence. After the scope and
blocker-capable review are stable, run the selected broad gates once for the
exact candidate. This is scheduling guidance, not an additional gate or an
approval requirement.

### PostHog Test Skills

The three test skills under `.agents/skills/` are pinned upstream copies;
each `UPSTREAM.json` records its source and revision. Update them deliberately
and review the upstream diff. Keep OpenMeld adaptations here, not in copied
skill bodies. Claude Code already routes through `AGENTS.md`; other agents
can follow its explicit file links without a global installation.

Use their judgment, not PostHog's toolchain: run the owning package's Vitest
or Node tests instead of `hogli`, Django, or Jest commands. For CI evidence use
`gh run view <run-id> --log-failed` and the relevant run attempt; PostHog's
insights and Trunk services are not configured here. Repository contracts and
the user's authorized scope take precedence over upstream approval steps.
Do not require a written questionnaire, repetition quota, or extra approval
for an ordinary authorized change.

Keep assertions tied to independent behavior. In PR #883, replacing an SQL
interpreter mock with SQLite made harmless SQL formatting changes pass while
detecting swapped persisted identifiers the mock missed. Use real persistence
when SQL semantics are the risk, with focused PostgreSQL tests for shared relational behavior and SQLite
tests for Durable Object or local Service storage. The skills' no-network advice applies to isolated unit tests, not
to explicitly selected integration or real-user smoke.

When cleaning substantial coverage, establish what still catches the important
failure. A focused temporary fault can demonstrate this when useful; mutation
testing is not mandatory for every PR. Control time when dates are fixtures,
and avoid asserting source text or incidental query formatting. Diagnose
deterministic failures before calling them flaky; do not use retries, skips,
or larger timeouts to hide an unexplained failure.

### Validation Commands

The Final Candidate, merge, release, health, smoke, evidence, and fallback
contract is owned by `developing/engineering/agent-native-delivery.md`. This
section owns only the lower-level test commands that its transparent planner
selects.

Canonical command families:

- focused package tests and checks for narrow changes;
- `pnpm check`;
- `pnpm build` when build output or package surfaces change;
- affected checks: `check:affected`, `test:affected`, and
  `test:integration:affected`;
- repository gates: `verify:pre-push:checks`, `verify:release-ready`,
  `verify:pr`, and `verify:pr:full`.

Web, Website, and Docs use TanStack Start 1.169.2 and Vite 8.3.4.
Remote Agent's Flue 2 build retains Vite 8.1.2, and the native Desktop build
retains Vite 7.3.7. Desktop's shared Web renderer uses the Web build.
Root Sherif configuration allows only those exact retained Vite versions to
differ; it does not disable the dependency rule or exempt a package. The
Rolldown override covers stable versions below 1.2 and explicitly covers the
1.0.0-rc.3 dependency used by tsdown, preserving the existing shared-package
bundler without downgrading Vite 8.3's required bundler. Reassess these entries when
upgrading either build, and remove them when the build versions converge.

The upstream history fix replaces the former local traversal patch. Keep the
Start compiler's build-end cleanup patch until upstream releases compiler
instances at that boundary; a build-start reset does not release the previous
environment's compiler between client and server builds.

Use Vite's native `resolve.tsconfigPaths` in these three builds instead of the
former paths plugin. Every test owner uses Vitest 4.1.11; Cloudflare Worker tests
run through `@cloudflare/vitest-plugin`. Its version-bound patch makes CommonJS
`require()` calls resolve with the `require` condition under Vite 8; see
[`patches/cloudflare-vitest-plugin.md`](../../patches/cloudflare-vitest-plugin.md).

The CI/CD procedure and its rationale have one owner:
[Agent-Native Delivery](agent-native-delivery.md#daily-workflow). It applies to
engineers and every coding agent. Read it before pushing a candidate or merging.

- Commit hook: staged-file checks.
- Development push hook: quick protected-release checks; no automatic affected
  builds or tests on ordinary branches.
- Draft PR: risk-selected local validation;
  keep work draft until ready to merge. There is no automatic full-PR hosted
  unit-test run on every Draft push.
- Standard FC: exact identity, trusted control, static contracts, and path-owned
  database/release readiness. No blanket unit or integration rerun.
- The owner validates changed behavior and downstream risks before marking ready.

Use `pnpm run verify:pr -- --feedback --plan` to inspect focused selection;
remove `--plan` when the selected checks fit the change, or run the necessary
owner checks directly. The feedback mode runs changed or adjacent Vitest tests,
not every test importing a changed component, and leaves non-Vitest package
test selection to the Agent. `verify:pr` remains the explicit affected-workspace
code/type-check and unit-test command, including downstream consumers.
`test:integration:affected` validates affected integration boundaries;
`verify:pr:full` requests whole-repository confidence. Do not use broad commands
as an automatic iteration loop. Fetch missing base history instead of ignoring
it; `OPENMELD_AFFECTED_BASE` chooses an explicit available base.

`verify:pre-push:checks` retains the static repository contract suite. It is not
a substitute for behavior tests or release readiness. Desktop dependency builds
use Turbo's cache so its package hooks do not rebuild unchanged contracts after
Turbo has already built them.

When a package-level script needs repo-root Turbo behavior from another working
directory, use the repo-root form with
`pnpm -C <repo-root> exec turbo ...`.

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

For real Center/Remote Agent model calls in a local lane, use the
[shared development BYOK smoke key](ai-billing.md#shared-development-byok-smoke-key).
That procedure owns the Doppler location, safe retrieval, product setup, usage
verification, and cleanup. Do not request a fresh key for each authorized smoke.

Real-user smoke must use user-accessible entry points and show user-visible
evidence.

Internal diagnostics are not smoke evidence by themselves.

These are internal diagnostics unless paired with a real user path:

- direct internal HTTP/RPC calls
- Cloudflare Worker subrequests
- PostgreSQL SQL reads or writes
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

Workflow scripts must not become direct PostgreSQL readers, direct Durable Object
readers, or a second trace system.

New cross-boundary behavior must stay diagnosable end to end. Before finishing
a flow that crosses Web, CLI, Gateway, Core, Durable Objects, shared PostgreSQL,
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
   a truthful `release/local-components-policy.json` decision;
2. the CLI publisher writes the release manifest that Core reads only after the
   declared binary channel and npm version are available.

`pnpm run deploy` enforces these checks. Do not bypass it with raw package
deploys, raw `wrangler deploy`, or raw npm publish. When a gate fails, fix the
commit and rerun the same command. Do not use a skip flag as a normal deploy path.

Internal staging uses its own guarded entry point:

```bash
pnpm staging:plan
pnpm staging:deploy
pnpm staging:verify
```

It never publishes production components. The deploy command requires a clean
worktree and reports the exact failing step. The complete staging boundary and
evidence rules are owned by
`developing/engineering/staging-environment.md`.

## Contract Impact Audit

Complete this audit before marking an implementation done and before any manual
deploy when the diff touches CLI, OpenMeld Service carrier files,
OpenMeld-managed local helper skills, Organization Skill delivery,
daemon/runtime schemas, Prepare Session schemas, shared HTTP/RPC/WebSocket
schemas, or `release/local-components-policy.json`.

This includes Wake, setup, reconnect, auto-update, permission or approval,
structured-reply, runtime-transport, and other critical user-path fixes when
their behavior crosses a local-component boundary. The audit questions below
own the engineering judgment. The explicit release command and monotonic floor
behavior are defined once in `production-release.md`; do not copy a second
policy table here.

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

### Trusted Delegation Contract Impact Audit

The Local task permission correction also adds an optional Core-owned requester
fact and assignment permission source. Roll out schema readers and Core before
the new Service: an old strict capability reader cannot accept the new
`executionContextPermissionInheritance` declaration. New Core accepts old
Services, but refuses inherited-permission contexts on those Services instead
of silently imposing a directory boundary. Retained bounded contexts and legacy
serial Wakes keep their previous contracts. New Web's **New task** uses the
existing `{ mode: new }` selection shape; old Core can parse it but does not
provide the corrected permission behavior, so expose this entry with the Core
rollout. Gateway passes no caller-supplied owner fact. Auth, Remote Agent and
Skills do not grant filesystem authority. Native permission settings, explicit
Computer policy, and task restrictions remain intersecting constraints.
This rollout order is required; it is not an assertion that a new Service can
register against an old Core or permission to update an installed Service.

The exact-evidence, ordinary Plugin delegation, excerpt-copy, and replay changes
touch shared schemas, Core RPC/HTTP, native Remote tools, the packaged CLI,
Service dispatch context, and the managed Plugin playbook.

- Existing setup, Service status, trace, rescue, token issuance/retirement, and
  finalization contracts remain unchanged. Ordinary human-source Plugin calls
  keep their prior response shape unless the caller opts into recovery receipts.
- New Local evidence tools and excerpt/verification commands require the new
  CLI. Older Core rejects unsupported exact-evidence/selection requests; clients
  must not substitute a latest version or broader history. Older Services receive
  the structured references rendered into source text without a new strict wire
  field. They cannot run delegated Plugin actions without the new private token
  forwarding and fail closed. Existing Wake/setup paths can continue, so local
  CLI, Service, and Skills updates are advisory (`available`). No token or
  permission floor is weakened and no automatic update is initiated.
- New Remote callers opt into Core delegation/permit projections and use new
  evidence read variants. Center's existing Space-context RPC adds opt-in
  `source_evidence` and `thread_evidence` scopes with a fixed version and offset;
  existing scope responses are unchanged. Older Core rejects these new scopes,
  so a caller cannot turn an unavailable exact read into a latest-version read.
  Personal Remote and Center share the same message-page response contract and
  Protocol version builders. Missing projections refuse the new path. Deploy the
  additive PostgreSQL migration before Core, Core receivers before Remote callers, and
  publish new Local artifacts only after Core is ready. Keep the mixed window
  short; old callers cannot use the new evidence or verification features.
- The immutable task/effect fence applies to newly recorded operations. Legacy
  Local operation signatures included the caller-chosen operation ID and did
  not retain the original input or dispatch identity. They cannot be safely
  reverse-mapped to the new effect key. Legacy unknown receipts remain unknown
  and receive no replay permit without a frozen account version. Before rollout,
  legacy active requests with unresolved writes need an explicit reconciliation
  boundary; do not claim cross-version new-ID deduplication for those rows or
  block unrelated later requests by guessing their task identity.
- Replay projection and the atomic journal claim both require a frozen original
  account version. A denied legacy replay cannot consume a claim through the
  execution RPC. Remote duplicate claims return the existing completed/failed
  receipt, original operation and account attribution through both direct tools
  and Code Mode; they do not reconstruct provider result data. The terminal
  receipt is a shared schema, not a new operation state or writer.
- Local writes without a trusted exact request now retain a private pending
  Plugin request before provider execution. The same operation, actor, account,
  input and permission revision reuse that request. Only the request owner's
  authenticated account with a Human Profile can approve its stable root.
  An Agent credential, selected Profile name, caller-issued confirmation token,
  new dispatch ID, restart or fork does not supply this authority. A manual
  approval remains bound to its executor. A recorded delegation can carry its
  original request root to its admitted child without another approval.
  An independently approved request may intentionally have identical content.
- Excerpt copies use the existing Files reservation, R2 object, revision commit,
  and audience owner. The new optional expected audience is checked synchronously
  at the destination commit. Completed copies have independent Files lifecycles.

#### Manual request authority and private Inbox confirmation

The approved threat model uses existing account credentials. An Agent's
delegation/execution credential cannot approve a Plugin request. The owner's
independently authenticated account can. The product does not claim human
presence when an Agent has been given the owner's full account credentials.
Do not add independent factor enrollment, email codes, or new recovery machinery
to this task.

Verified owner Wakes and recorded Center delegations reuse their Core-derived
original request root. Cold continuation and selected child execution preserve
the same task/effect fence. A new operation ID or executor cannot repeat the
write. Current access, membership, delegation, exact input and account version
are still checked. Only the original executor can claim a permitted provider
replay; other executors receive its original receipt.

A manual Local call with no verified request provenance creates a private
`plugin_action_requests` record (migration 0192). It freezes the actor, original
requester, account version, access revision, action, effect and input. Inbox
holds an opaque request ID and input-free preview. The inline detail shows
bounded reviewed labels and identifies omitted input. Core requires a Human
Profile and an authenticated account principal matching the request owner
before approving or declining. Agent-supplied identity text is not authority.

Approval and Inbox resolution use one conditional PostgreSQL transaction. Repeated decisions
return retained state; conflicting decisions fail. Execution rechecks approval,
membership and connection/access revisions. Requests expire after one hour.
Replay retains the operation's single durable allowance and original 24-hour
maximum window. A separately approved new request does not resolve an older
unknown result.

Deploy current Gateway/shared schema and replay readers before the Core writer,
apply migration 0192, then deliver Web/CLI consumers. The unreleased email-code
prototype has no supported installed consumer and is removed. Inbox capability
10 adds request details; older consumers receive guidance to current Web.
This is a rollout dependency, not permission to deploy. Stamp the final local
components and verify release readiness. Storage tests, browser smoke, native
model execution and actual provider writes remain separate evidence.

### Active-Wake Agent Settings Contract Impact Audit

Active-Wake Agent settings change Web behavior, Core Binding writers,
RuntimeCoordinator's Core-owned execution-target mutation RPC, and shared PostgreSQL
Binding storage. They do not change CLI commands, OpenMeld Service frames,
Prepare Session, Wake dispatch frames, Space Actions, trace/diagnostics, or any
local Agent Controller adapter.

- First deploy only the Core compatibility bridge while the old PostgreSQL schema is
  still active. The bridge keeps the historical Durable Object
  `rpc*AgentProfileControllerMutation` wire names, admits every owner shard
  before an execution-target change, and atomically disables admitted legacy
  Bindings, installs or reuses the canonical hosted target, and carries its
  Organization authorization in one guarded PostgreSQL transaction. Do not select Database
  in this first release. Confirm that Core's active version carries the merged `RELEASE_SHA`
  before continuing; this is the
  observable bridge-propagation signal, and the old wire names keep old and new
  RuntimeTransportHub instances interoperable during the wait.
- After the bridge is confirmed active, set the designation-only gate with
  `pnpm ops:remote-agent policy --env prod --disable-designation`, land that
  single Wrangler policy change, deploy Core with
  `pnpm run deploy -- --scope core --lane local`, and verify an authenticated
  Remote Agent designation attempt returns
  `center_agent.remote_designation_paused`. Existing Remote Agent execution
  stays enabled; do not use the broader runtime kill switch for this rollout.
- With designation visibly paused, apply canonical-Binding historical D1 migration `0140_aspiring_masked_marvel`.
  Its profile-first partial index bounds legacy-owner discovery, and its write
  triggers preserve existing legacy rows while rejecting any new or re-enabled
  noncanonical or parallel enabled primary Binding. Then set the gate back with
  `pnpm ops:remote-agent policy --env prod --enable-designation`, land that
  single policy change, deploy and verify Core again, and deploy Web last. An
  authenticated designation must succeed before the rollout is closed.
- No Runtime Transport epoch, OpenMeld Service contract, CLI command contract,
  or local-component release stamp changes. The broader execution-target schema
  names remain internal to Core; the Durable Object RPC wire names stay
  backward-compatible throughout eventual Worker and shard propagation. Old
  and new local components keep their existing setup, Wake, status, Space
  Action, and diagnostic behavior.
- Rollback keeps the PostgreSQL index and triggers. Never restore a Core version from
  before execution-target admission, even if the migration has not run yet;
  keep designation disabled and roll Core forward with a compatible fix. Web
  can roll back independently because it does not own Binding or execution
  truth. Never delete or rewrite legacy Binding rows as a rollback shortcut.

#### Live permission-mode reconciliation

Live permission-mode reconciliation changes the CLI-carried local Service and
the process-internal `RuntimeAdapter` contract. It reuses the existing
`daemon.route_catalog.changed` signal, expected-routes projection, Binding
schema, Wake dispatch frame, Agent Interaction response path, and diagnostics
transport. Approval sequencing additionally extends permission requests with
optional `supportsPermissionModeUpdate` and responses with an optional reference
to a saved Binding (`permissionModeUpdate`). The reference contains no execution
authority; Service reads the canonical route before attempting a native update.

- Deploy Web, Gateway, and Core readers for the optional fields before publishing
  the new CLI/Service producer. Old strict cloud schemas reject new permission
  requests, so publishing the local producer first is not supported. New Web
  only sends the response reference when the pending request advertises support.
  New cloud continues to accept old Service requests and ordinary approval
  responses. Older local components retain their existing live-update subset or
  future-work-only behavior; setup, Wake dispatch, status, Space Actions,
  diagnostics, and self-rescue commands keep their current contracts.
- The new local component applies a mode to an active task only after a
  controller adapter acknowledges native support. Unsupported providers and
  modes keep the starting mode and do not block catalog convergence, existing
  Wake work, setup, status, Space Actions, trace, or diagnostics.
- No Runtime Transport epoch, OpenMeld Service contract, CLI command contract,
  or shared schema constant changes. At publication time, stamp the touched
  CLI/Service artifact as advisory `available`; existing local components remain
  safe without a forced update. The receiver-first order above is required.
- Rollback removes the local live-update capability and returns to the previous
  future-work-only behavior. It must not rewrite Binding state, active Wake
  state, or pending Agent Interactions. Once a new Service is published, retain
  cloud readers for the optional fields during rollback. Web and local native
  update behavior can roll back independently; do not restore strict cloud
  schemas that reject requests from the already published Service.

### Local Installation Recovery Contract Impact Audit

- Boundaries: Codex host-app discovery and persisted launch reconciliation,
  additive optional ACI `launch.failureReason`, and Web installation controls.
  The raw message/path privacy boundary remains unchanged. Setup, Wake frames,
  Space actions, status, trace, and self-rescue commands retain their contracts.
- Publish schema consumers before the Service emits the optional reason. Old
  Services omit it; new Web retains generic repair guidance. Old cloud uses a
  strict snapshot schema and must be upgraded before the new producer. Rollback
  must retain the additive schema reader while new Services remain connected.
- The Service contract advances to
  `openmeld-service-contract-2026-09-local-install-recovery-v1`. The release
  owner must stamp Service **required**: old carriers retain a disappeared Codex
  App executable and cannot recover the affected Wake path. Use the existing
  required-update floor and automatic updater, preserving accepted work and
  self-rescue. Do not invent a separate connection reset or rollout mechanism.
- CLI commands remain compatible; stamp CLI **available** unless another change
  in the release requires a higher floor. Feature branches leave release version
  and manifest untouched. The clean release PR stamps the exact post-merge
  artifact and publishes CLI/Service before Core advertises its required floor.
- Cursor keeps its provider-owned relocation rule. Other providers share stable
  entrypoint preservation, typed file-failure diagnostics, and owner selection
  even with one alternative. Node-version or package-channel changes do not
  authorize silently adopting a different installation.

### Safe Local Agent Installation Selection Contract Impact Audit

Local Agent update extension: publish Core/Gateway/schema readers before a Service
advertises optional `updateInstallations`. New owner-only GET/POST
`installation-update` routes reuse the existing installation transport with
`read_update`/`update` requests and a distinct `update_state` result. Old Services retain
selection and manual updates; new controls require the new capability. Existing
list/select responses, Prepare, Wake, Skills, and Space Actions are unchanged.
Web and Desktop share the Computer UI and API client. No native Desktop bridge,
database schema, contract floor, or forced update is required. Service/CLI release
impact is advisory `available`; this feature branch does not stamp release
artifacts. Rollback must retain readers while new Services advertise the field.

Safe installation selection changes Web behavior, Local Runtimes HTTP/RPC,
Runtime Transport capabilities and result frames, the OpenMeld Service carrier,
and the process-internal local execution-slot contract. It does not change
Prepare Session, Wake dispatch frames, Space Actions, controller adapter
contracts, diagnostics, PostgreSQL, or the local registry schema.

- Deploy the additive schema consumers in Core, Gateway, and Web before
  publishing the new local component. The daemon capability and result field
  remain optional on the mixed-version wire, so old Services keep setup, Wake,
  status, Space Actions, and diagnostics working.
- New cloud requires both `manageInstallations` and
  `manageInstallationsSafely` before listing or selecting installations. An old
  Service therefore loses only the unsafe installation selector until it
  updates; existing and new Wake work remains available.
- New local components advertise the safe capability, report selection status,
  reject changes while matching work is queued or active, and queue work that
  arrives during an admitted registry write. This producer must not be
  published before cloud consumers accept the additive fields.
- No Runtime Transport epoch, OpenMeld Service contract, or CLI command
  contract bump is needed because established Wake/setup frames remain
  compatible and the new capability fails closed independently. Stamp the
  Service artifact as advisory `available`; existing installations need not be
  forced to update for Wake safety.
- Rollback hides cloud selection first, then retires the local producer. Do not
  roll strict cloud schema consumers back while a Service that emits the
  additive capability and selection status remains connected.

### Local Agent Interaction Contract Impact Audit

The local Agent Interaction rollout changes shared HTTP/RPC/WebSocket schemas,
Runtime Transport frames, RuntimeCoordinator state, the OpenMeld Service
carrier, and all supported local-agent adapters. It does not change setup,
Prepare Session, dispatch-owned Space Action, diagnostic, or PostgreSQL schemas.

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
  contract constant or PostgreSQL migration is required for this additive ordered
  rollout.
- Rollback disables the new local producer before rolling Core back. An
  already-running interaction must be stopped or allowed to reach an explicit
  terminal outcome; rollback must not strand a provider waiter or rewrite
  RuntimeCoordinator state.

### Explicit Space Recipients Contract Impact Audit

Space authoring uses selected Profile IDs and relations. CLI command behavior
changes: generic sends and dispatch actions accept full Profile IDs through
explicit recipient options, while old inline relation syntax is literal text.
The CLI command and official Skill contracts advance together so a new CLI
does not install old inline-authoring instructions from the signed Skill
channel. Old CLIs keep their compatible Skill release; new CLIs use their
bundled matching instructions until a matching signed release is published.

The HTTP/WS message envelope, membership checks, Core Wakeability, dispatch
authority, Service execution epoch, and final-result protocol do not change.
Old clients already send structured targets, so new Core can continue existing
setup, Wake, actions, status, trace, and recovery. New clients also send the same
envelope to old cloud code. Deploy Core's source-text preservation before the
new CLI/Web so literal examples are never stripped from a dispatched prompt.
No running Wake or historical message is rewritten.

The final release must stamp the
new CLI/Skill contracts, publish the matching signed Skill channel with the new
CLI version as its minimum, and preserve the previous signed contract release.
The CLI and Skills updates are required because their command and Skill contracts
advance. The Service update remains available because its execution contract is
unchanged. Wire compatibility preserves accepted work during rollout; it does
not waive the required update policy for changed contracts or force a Service
restart. Scripts moving to the new CLI must migrate inline syntax to explicit
recipient flags.

### Agent Reply Context Review Contract Impact Audit

Agent reply context review changes the shared Runtime Transport capability and
result-response schemas, the Service result outbox and exact-conversation
continuation path, RuntimeCoordinator result settlement, and Space atomic final
reply publication. It does not change setup, Prepare Session, CLI command,
Gateway HTTP, PostgreSQL schema, or controller-specific adapter contracts.

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
command contract version, or PostgreSQL schema changes.

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
  Prepare the version and local-component manifest once the release source is stable.
- Rollback removes or disables the Grok local producer before rolling back the
  shared cloud receivers/catalog. Any active Grok Wake must first reach one
  explicit reply, stopped outcome, or failure; rollback must not reinterpret a
  Grok ACP session as another controller or retry it through Headless JSON.

### Center Agent Local Agent Bridge Contract Impact Audit

The Center Agent Local Agent bridge adds the `openmeld center-agent ask`
command, optional Local Agent source metadata on the existing Center Agent Chat
ingress, the `receive_local_agent_request` Audit Log action set v14, Center
Agent Task response contract v3, and nullable Task origin attribution in shared
historical D1 migration `0106_flimsy_angel`. It does not change setup, Prepare Session,
Runtime Transport, Wake execution, dispatch-owned Space Actions, Service
status, trace selectors, or self-rescue commands.

- Verify the native schema originating in historical D1 migration `0106_flimsy_angel` before deploying the Core reader and
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
v15, `openmeld center-agent context`, and historical D1 migration `0107_heavy_stick`.
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
change. Rollback stops the Core emitter before rolling Remote Agent back; no PostgreSQL
migration, local-component contract bump, or release stamp is required for this
hosted additive contract.

The Context Load Receipt side adds shared receipt v1, Audit Log action set v16,
`openmeld center-agent context receipt`, and additive historical D1 migration `0108_tiresome_magik`. The migration creates the manifest-materialization and
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
relational migration and creates no second artifact or transcript store.

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

Codex Collaboration Mode adds nullable PostgreSQL Binding metadata, shared
Binding/Gateway/Core schemas, negotiated expected-routes v2 output, local route
cache metadata, Center Agent model-visible runtime-setting inputs, and Codex App
Server `turn/start` behavior. It does not change Runtime Transport frames,
setup, Prepare Session, Space Actions, Wake outcome authority, or existing v1
expected-routes output.

- Verify the native schema originating in historical D1 migration `0079_curvy_rocket_raccoon` before deploying the Core
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
  Core. The nullable PostgreSQL column remains in place; rollback must not rewrite
  Binding rows or active RuntimeCoordinator execution state.

### Space Files Origin Classification Contract Impact Audit

Space Files origin classification (`artifact` vs. `chat_upload`) adds a
nullable `origin` column to Core's `space_file_entries` SQL, an `origin`
field on shared file-descriptor and list-response HTTP schemas
(`packages/schemas/src/schemas/http/space-files.ts`), an optional `origin`
query filter on list, Web/CLI/Remote Agent write-path defaults, and a
**negotiated response capability** so the new `origin` field never reaches a
caller that has not explicitly declared it understands the field. It does
not change Runtime Transport frames, setup, Prepare Session, Wake dispatch,
Space Actions, PostgreSQL schemas, or any local-component/service contract version.

**Why negotiation, not a bare additive field.** Per
[Schema rules](../architecture/shared-contracts.md#space-access-context-propagation),
"published CLI versions can never be forced to update first," so a shared
response addition must preserve an already-published frozen strict reader —
adding `origin` directly to `spaceFileDescriptorSchema`/
`listSpaceFilesResponseSchema` (both `z.strictObject()`) would have broken
every already-published CLI and Remote Agent build on every Space Files
response, which an earlier revision of this audit incorrectly accepted as a
forced-update policy. That is corrected here: **old requests continue
receiving the exact pre-origin response shape (no `origin` key anywhere);
only a caller that explicitly opts in receives `origin`.** One canonical
`origin` fact remains on `space_file_entries`; only the wire projection
varies by caller capability.

**The negotiation mechanism, one per transport boundary:**

- **Gateway HTTP (Web, CLI).** A capability header,
  `x-openmeld-space-files-origin-version: 1`
  (`OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION`/
  `OPENMELD_SPACE_FILES_ORIGIN_VERSION` in `packages/gateway-contract`).
  `services/gateway/src/routes/rpc-http.helpers.ts`'s `executeRpcRoute`/
  `executePublicRpcRoute` accept `includeLegacySpaceFilesOriginWireFields:
  true` (mirroring the existing `includeLegacySpaceAddressingWireFields`
  pattern) and, when the caller's request lacks the header, apply
  `toLegacySpaceFilesOriginWireValue` — a pure recursive JSON walker in
  `packages/schemas/src/compatibility/legacy-space-files-origin-wire.ts`
  (mirroring `toLegacySpaceAddressingWireValue`) — to the **already-validated
  response**, stripping every `origin` key regardless of whether Core
  actually sent it or Gateway's own schema default materialized it. Every
  file-bearing Space Files route opts in: list, get, list-revisions,
  update-entry, restore-entry, restore-revision, upload (both the direct and
  multipart/raw paths), and Composer publish. Non-file-bearing routes
  (create-folder, trash, Composer stage/discard, content download) carry no
  `origin` field and are unaffected.
- **Core/Remote Agent RPC (Center Agent tools).** This boundary has no HTTP
  headers, so the capability is an explicit optional field,
  `requestedOriginModel: "origin_aware"`
  (`SPACE_FILES_ORIGIN_CAPABILITY_TOKEN` in `packages/schemas`), added once
  to the shared `centerAgentSpaceFileScopeSchema` base that every Center
  Agent Space Files RPC input schema extends
  (`packages/schemas/src/schemas/http/center-agent-space-files.ts`). Core's
  `CoreEntrypoint` methods (`centerAgentListSpaceFiles`,
  `centerAgentReadSpaceFile`, `centerAgentSaveSpaceFile`,
  `centerAgentManageSpaceFiles` in `services/core/src/index.ts`) wrap the
  underlying `rpcCenterAgent*` call in `withSpaceFilesOriginRpcOutput`
  (mirroring `withSpaceAddressingRpcOutput`), which strips `origin` unless
  the caller's `requestedOriginModel` matches the token exactly. Remote
  Agent's tool-calling code
  (`services/remote-agent/agent-core/tools.ts`) sets this token on every one
  of the four Space Files tool calls.
- **Gateway/Core RPC (every ordinary Gateway-facing Space Files method).**
  This is a third, independent boundary from the two above: current Gateway
  and current Core are separately deployed Workers, and Core's *ordinary*
  Gateway-facing entrypoint methods (`listSpaceFiles`, `getSpaceFile`,
  `listSpaceFileRevisions`, `updateSpaceFileEntry`, `restoreSpaceFileEntry`,
  `restoreSpaceFileRevision`, `writeSpaceFileContent`, `spaceFileUpload`,
  `publishSpaceComposerUpload`, `streamSpaceFileContent` in
  `services/core/src/index.ts`'s `CoreRpcEntrypoint`, redeclared with the
  same signature on `GatewayRpcEntrypoint`) are a *separate* call path from
  the four `centerAgentXxx` methods above — wrapping only those four does not
  protect this path. Each of these methods now accepts an optional
  `spaceFilesOriginVersion` second argument, mirroring exactly how
  `listSpaceThreads`/`getSpaceThread`/`getSpaceMemberDirectory`/
  `getSpaceBootstrap` already accept `spaceAddressingVersion` for the
  addressing rollout, and downgrades its response
  (via `withSpaceFilesOriginRpcOutput`, or
  `withSpaceFilesOriginStreamRpcOutput` for `streamSpaceFileContent`, whose
  resolved value embeds a live `bytes: ReadableStream` that the generic JSON
  walker would otherwise corrupt) unless the caller passes
  `OPENMELD_SPACE_FILES_ORIGIN_VERSION` exactly. Current Gateway's HTTP route
  handlers (`services/gateway/src/routes/rpc-http.space-files.ts`) always
  pass that constant on every one of these calls, independent of whether the
  *HTTP* caller declared its own capability — Gateway always wants the full
  data from Core so it can apply its own HTTP-caller-facing projection
  (the first bullet above). An already-published Gateway build has no such
  second argument on any of these calls and never sends it, so it keeps
  receiving the exact pre-origin response shape from a new Core.

**Supported matrix, proven by behavior tests, not asserted:**

- *Any caller (old or new) + Gateway/Core, default request, no capability
  declared*: safe — response omits `origin` entirely, matching the exact
  pre-origin shape. An already-published CLI's frozen strict schema parses
  this successfully because the key it never learned about is genuinely
  absent, not defaulted-and-present.
  `services/gateway/tests/space-file-routes.test.ts` ("strips origin from
  every file descriptor for a caller that has not declared the origin
  capability", "strips origin from a single-file read (getSpaceFile) for a
  non-capable caller").
- *New reader declaring the capability + a producer that predates `origin`
  entirely* (old Core, or a transient rollout window before Core
  redeploys): safe — the missing key still defaults for the capable caller
  (`origin: null` on a descriptor, `"artifact"` on a list), and the capable
  caller already knows how to interpret that default.
  `packages/schemas/tests/http/space-files.test.ts` ("lets a current reader
  parse a response from a producer that predates origin");
  `packages/api-client/tests/space-api.test.ts` ("keeps default Space Files
  listing working against a Core response from before the origin filter
  existed").
- *A capability-declaring caller requesting `origin: "all"` against a
  producer that predates `origin`*: fails explicitly, not silently. The
  missing response field still defaults to `"artifact"`, which does not
  match the requested `"all"`; the existing `packages/api-client/src/space/
  files.ts` filter-echo check throws `OpenMeldApiClientInvalidResponseError`
  (the same mechanism already used for the `view` field).
  `space-api.test.ts` ("fails closed instead of silently showing an
  unfiltered list as chat uploads during rollout").
- *Gateway is new, Core still predates `origin`, caller has not declared the
  capability*: safe and non-leaking. Gateway's own current schema still
  defaults the missing key during validation, but the origin-capability
  check runs **after** validation and strips the key regardless of whether
  Core sent it or Gateway's schema default produced it — no cloud step
  emits `origin` to a non-capable caller merely because a schema default
  materialized it. `space-file-routes.test.ts` ("never leaks a
  schema-defaulted origin to a non-capable caller even when Core itself
  predates origin").
- *An already-published CLI or Remote Agent (built before this release) +
  new Core/Gateway*: safe — it never sends the capability header/field
  (it has no code path that could), so every Space Files response it
  receives is downgraded to the exact shape its frozen schema already
  parses. `packages/schemas/tests/http/space-files.test.ts` ("documents that
  an already-published pre-origin strict reader rejects the new response
  shape") proves *why* this matters — a frozen reader genuinely cannot
  tolerate the field present — which is exactly what the negotiation now
  prevents from happening to it.
  `services/core/tests/organization-rpc.test.ts` ("strips origin from a
  Remote Agent's Space Files response unless it declares the origin
  capability") and `services/remote-agent/tests/tools.test.ts` (the
  `openmeld_list_space_files`/`openmeld_read_space_file`/
  `openmeld_save_space_file`/`openmeld_manage_space_files` scenarios, which
  assert the tool layer always sends `requestedOriginModel: "origin_aware"`)
  prove the Core/Remote Agent direction end to end.
- *An already-published (frozen) Gateway build + new Core*: safe — Core's
  ordinary Gateway-facing methods (the Gateway/Core RPC boundary above)
  downgrade their response whenever the caller omits
  `spaceFilesOriginVersion`, which an already-published Gateway's compiled
  code has no way to send. `services/core/tests/organization-rpc.test.ts`
  proves the underlying `withSpaceFilesOriginRpcOutput` gate at the
  entrypoint level, and
  `packages/schemas/tests/http/space-files.test.ts` ("lets a frozen
  pre-origin Gateway parse a current Core response once the Gateway-to-Core
  RPC boundary downgrades it") reconstructs the exact frozen Gateway
  response schemas for every representative Gateway-facing operation
  family (get, upload/write, restore-revision, list-revisions,
  update-entry, restore-entry — both the file and folder entry variants)
  and proves each accepts the downgraded value while rejecting the raw
  new-shaped one.
  `services/gateway/tests/space-file-routes.test.ts` ("declares the origin
  capability on the Gateway-to-Core RPC boundary for every file-bearing
  operation...") proves current Gateway's own route handlers always pass
  the version constant on this boundary, independent of the calling HTTP
  client's own capability.
- **No required CLI/Remote Agent update.** Because the response is
  negotiated rather than unconditionally additive, there is no forced-update
  policy and no CLI release-note warning to write. An old CLI or Remote
  Agent keeps working indefinitely with the pre-origin behavior (an
  unclassified caller never sees `origin`, never sees the chat-upload
  filter, and cannot request `--all`); it simply does not gain the new
  capability until it updates — the same "advisory `available`" shape as
  every other additive local-component change in this file, not a breaking
  one.
- **Core (schema and repository) — the migration is retry-safe.** The
  Durable Object schema migration bumped `SPACE_SQL_SCHEMA_VERSION`/
  `SPACE_SQL_SCHEMA_CHECKSUM` to 45 specifically for this repair: any
  database that already recorded schema v44 (including one that ran an
  earlier, buggy copy of this migration that left rows unrepaired) does not
  match v45 and re-enters the full migration, which repairs it. Within that
  migration, `ensureSpaceFileEntriesOriginColumn` adds the `origin` column
  via `ALTER TABLE` only when it is missing, but then **unconditionally**
  runs `backfillSpaceFileEntriesOrigin` (`UPDATE ... WHERE kind = 'file' AND
  origin IS NULL`) every time this function runs — whether the column was
  just added, already existed with every row classified, or already existed
  with rows still `NULL` from an earlier incomplete run. This mirrors the
  existing `ensureSpaceMetaAccessModeColumn` repair pattern in the same
  file. There is no reliable signal in pre-existing rows to recover a
  historical chat upload versus deliberately created work — both wrote
  through the same path before this column existed — so `'artifact'` is the
  deterministic backfill target, matching the repository's create-time
  default. Folders are excluded from the backfill (`kind = 'file'` guard)
  and never carry an `origin`. After migration, a `NULL` origin on a file
  row is exceptional/corrupt data (for example a direct database edit), not
  normal history, and the read path still fails closed on it (excluded from
  the default `artifact` list, included only under `origin: "all"`).
  `services/core/tests/space-file-entries-origin-migration.test.ts` proves
  this against a real Durable Object SQLite instance: nested file/folder
  outcomes, the interrupted/earlier-v44 repair path (column present, rows
  still `NULL`, migration marker removed to force re-entry), unchanged
  folder placement, and idempotent rerun of both the short-circuit and the
  full migration body.
- **Core (write path, legacy interoperability).** `SpaceFileRepository
  .commitWrite` treats a missing `origin` on a new-file write
  (`baseRevision === null`) as `'artifact'`, not `NULL`. `origin` is
  otherwise immutable — set once at file creation and never touched by a
  later revision write, an update, a trash, or a restore. Explicit
  `chat_upload` writes (Web Composer publish, CLI `space send --file`)
  always set `origin` themselves and are unaffected by this default.
- **Gateway / Core HTTP request side is safe independent of negotiation.**
  `origin` stays optional on `listSpaceFilesQuerySchema`,
  `createSpaceFileUploadQuerySchema`, and
  `prepareSpaceFileWriteInputSchema`/`commitSpaceFileWriteInputSchema`. An
  old client that never sends `origin` on a request is unaffected: Core
  applies the deterministic default above. This direction was never in
  doubt; the request-side field was optional from the start and no
  strict-object rejects an *absent* key.
- **Web.** New Web builds send the capability header on every Space Files
  request (`packages/api-client/src/space/files.ts`) and explicitly send
  `origin: "artifact"` for Files-panel uploads and Markdown-file creation;
  `origin: "chat_upload"` is set server-side for Composer-published
  attachments. The Files list defaults to `origin: "artifact"`; a "Show chat
  uploads" toggle switches to `origin: "all"`. The "Chat upload" badge
  renders only when `entry.origin === "chat_upload"` — never for
  `NULL`/unclassified. The toggle resets to its default `false` on every
  `changeView` call. Web, Gateway, and Core deploy together as one
  coordinated release, so Web always declares the capability against an
  origin-aware Gateway/Core in steady state.
- **CLI.** `space files upload` sends `origin: "artifact"`; `space send
  --file` sends `origin: "chat_upload"`. `space files list` defaults to
  `artifact` and accepts `--all` to request `origin: "all"`. A CLI built
  from this release or later declares the capability header on every Space
  Files call (via the same shared `packages/api-client`) and reads `origin`
  back normally. A CLI built before this release never declares the
  capability and is fully unaffected — see the supported matrix above.
- **Remote Agent.** Agent-authored output files
  (`publishRemoteAgentOutputFile`) always set `origin: "artifact"`. The
  `openmeld_list_space_files` tool exposes the same `origin` filter
  (`"artifact"` default, `"all"`) as the HTTP/RPC contract, and every Space
  Files tool call sets `requestedOriginModel: "origin_aware"`.
- **Rollout order.** Deploy in the standard coordinated order (Auth, Web,
  Gateway, Core, Remote Agent). Because the response is negotiated on all
  three boundaries above (HTTP client/Gateway, Gateway/Core RPC, Core/Remote
  Agent RPC) rather than unconditionally additive on any of them, there is
  no ordering constraint beyond normal deploy hygiene: any mix of old/new
  Web, Gateway, Core, CLI, and Remote Agent is safe in either direction,
  proven directly by behavior tests for each pairing above — not asserted
  from deployment order — since a non-capable caller never receives the
  field regardless of which side changed first. No local-component contract
  version or Runtime Transport epoch changes. `SPACE_SQL_SCHEMA_CHECKSUM`
  does change (v44 → v45) specifically so a database stuck in a broken v44
  state self-heals on the next deploy; this is intentional, not an
  oversight, and safe to apply at any point in the rollout since the
  migration is additive and self-repairing.
- **Rollback.** Rolling back Core does not need to reverse the migration:
  the `origin` column and its backfilled values are additive and harmless
  to a pre-feature Core build, which simply never reads or writes that
  column. Do not delete or null out backfilled `origin` values as part of a
  rollback; that would recreate the exact historical-file-hiding defect
  this migration fixes. Rolling any single component back to a pre-origin
  version is safe under this negotiated contract on all three boundaries: a
  rolled-back component simply stops declaring (Gateway/Core RPC,
  Core/Remote Agent RPC) or stops honoring (HTTP client/Gateway) the
  capability, and every caller on the other side of that boundary reverts to
  the pre-origin response shape it already understands — including rolling
  Gateway back to a pre-origin build while Core stays current, which the
  Gateway/Core RPC negotiation now covers explicitly (see above); it was not
  covered before that negotiation existed.

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

Agent Activity adds PostgreSQL truth, strict cloud contracts, an OpenMeld Service
observer, managed provider integrations, a Remote Agent digest consumer, and a
published CLI surface. Keep its producer windows explicit:

1. Apply `0029_agent_activity_projects` before
   `0030_agent_activity_events`, then apply
   `0031_agent_activity_retention_indexes`. Never drop or rewrite these tables
   during rollback.
2. Deploy shared strict readers and a Remote Agent worker that accepts the
   digest RPC before Core can enable digest production. Deploy the Core Session
   Inventory receiver before Remote Agent exposes
   `openmeld_list_agent_activity_sessions`. After that receiver is live, set
   `OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED=true` in Remote Agent wrangler
   vars for the Center Agent caller window. Configure
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

Agent Task Coordination adds strict shared task schemas, Core PostgreSQL coordination,
private Center Agent tools, Runtime Reporting callbacks, a Local OpenMeld
Service outbox, and managed Codex/Claude Code Hook artifacts. Keep the receiver,
storage, and local-producer windows explicit:

1. Verify the native schema originating in historical D1 migrations `0051_motionless_firestar`,
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
the PostgreSQL ledgers for replay and diagnosis. Agent Task Coordination remains a
coordination projection throughout; RuntimeCoordinator, native delivery, and
controller-native providers keep execution authority.

### Execution Recovery and controlled-drain contract impact audit

Execution Recovery adds a strict public capability projection, two recovery
commands, nonterminal recovery notice variants, Runtime Transport drain and
exact-conversation frames, a Service capability bit, and one Agent Task
Coordination observation table. Roll it out consumer and storage first:

1. Verify the native schema originating in historical D1 migration `0083_young_red_shift` before Core can persist
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

1. Verify the native schema originating in historical D1 migration `0025_center_agent_routines` before
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
worker consumer. Preserve the PostgreSQL definition and Run ledger throughout rollback.

Routine execution is Workflow-first. Keep
`OPENMELD_ROUTINE_ENGINE_DEFAULT=workflow` for normal local and production
operation. Use `OPENMELD_ROUTINE_ENGINE_DEFAULT=legacy` for an emergency global
rollback, or add Organization ids to the comma-separated
`OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS` list for a scoped rollback. Restart
Core after changing either value. The selection applies only to newly claimed
Runs: each Run freezes its engine at claim time and never crosses from Workflow
to legacy after Workflow ownership begins. Do not test rollback by editing
`routine_runs.execution_engine`; change the configuration, create a new
occurrence, and compare the new Run's PostgreSQL record, Workflow instance status,
native-delivery ledger, and single Space result.

Before removing the last production legacy override, prove one complete
user-visible Routine through Web or the published CLI and keep the following
operator views open for the validation window:

1. Cloudflare Workflow metrics for failed and terminated instances, failed step
   attempts, retry counts, and unusually long waits;
2. OpenMeld Analytics Engine events under
   `core.openmeld.routine_workflow.*`, correlated by `dispatchId = runId`;
3. the PostgreSQL Run and native-delivery ledger for that same Run id; and
4. the target Space, which must contain at most one final success or explicit
   failure result.

Alert or apply a legacy override for future Runs when an instance is
terminated, recovery is blocked, callback forwarding repeatedly fails, a
Workflow completes while its PostgreSQL Run remains nonterminal, one Run produces
multiple model admissions or Space results, or the Run/ledger/Workflow target
or identity evidence diverges.
Do not page on ordinary `waiting` instances or a single platform-managed step
retry. Cloudflare Event Subscriptions may later route native Workflow failure
events to an owned Queue or HTTPS consumer, but that resource is not part of
the current implementation until its binding, consumer, generated types, owner
docs, and deployment gate are added together.

For blocked recovery, inspect the instance with the supported Wrangler Workflow
instance commands and correlate it with the PostgreSQL Run before acting. Restart only
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
2. record an explicit policy in `release/local-components-policy.json`;
3. run `pnpm run verify:release-ready`; and
4. publish through `pnpm run deploy -- --scope cli` so the package, binary
   channel, tag, and release manifest come from the same commit.

Compatibility review currently supports an advisory `available` policy for
the CLI and any restamped Service bundle because existing setup and Wake work
can continue without the new Routine commands. The final release card must
reconfirm and record that policy; only an incompatibility found there may
promote it to `required`. Do not bump versions or stamp the manifest on a
feature/docs branch that will not publish.

## Desktop Preview Release Workflow

### Optional GitHub macOS release

`.github/workflows/desktop-release.yml` provides a manual `macos-15` lane for
the same production package, immutable upload, and guarded promotion commands
used locally. Dispatch it from `main` with an exact merged `release_sha` (or
leave the SHA empty to select the dispatched main commit).

- `operation=candidate` builds, signs, notarizes, verifies, and uploads a
  macOS arm64 candidate. It does not change the stable channel. The run summary
  records the version, source SHA, candidate hash, and public candidate page.
  Build and upload use one job and one toolchain setup. Re-running that job
  rebuilds the candidate; it is not a publication-only retry. A local retry with
  the same signed bytes can reuse an already uploaded candidate. Never rebuild
  a candidate that has already been reviewed for promotion.
- Complete the public-download and installed acceptance below. Then explicitly
  dispatch `operation=promote` with the same `release_sha`, successful
  `candidate_run_id`, reviewed `candidate_hash`, and `expected_version` (or
  `none` for an empty channel). This restores the small candidate metadata from
  that run, matches it to authoritative R2 metadata and public artifact hashes,
  and uses the existing
  shared `web` lease and sole promoted pointer. It does not rebuild or resign.
- GitHub retains candidate metadata for 30 days; the immutable R2 candidate
  owns the signed bytes. Promotion does not download another local installer,
  mount it, repeat notarization checks, rebuild, or resign. Native signature and
  embedded-source inspection belong to candidate upload; hashes preserve that
  identity through promotion. A local promotion needs the reviewed metadata
  in `clients/desktop/dist/production-preview/candidate.json`, not local DMG/ZIP
  copies. Both local and GitHub promotion keep the public download checks,
  expected-version comparison, release lease, and installed update acceptance.

Both lanes use the existing company Developer ID and notarization account.
The GitHub `production` environment supplies the same six `APPLE_*` credentials
as the CLI release: the P12 certificate and password, P8 key, key ID, issuer ID,
and team ID. The shared Apple signing owner imports them into an ephemeral
Keychain, gives Electron Builder its Keychain path and notary profile, and
removes the temporary credentials after packaging. Local releases continue to
use the installed Keychain identity and `openmeld-notary` profile. No second
certificate, updater feed, or publication implementation is introduced.
GitHub's existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment
secrets supply the named Desktop publisher contract.
Validate a replacement P12 with native `security import` before synchronizing
it. OpenSSL accepting a P12 password does not prove native Keychain support.

The workflow supports macOS arm64 only. A successful candidate run proves
packaging and upload, not installed launch, login, or A-to-B update acceptance.
Windows signing and release remain on their existing native lane.

### Shared candidate and promotion procedure

For the current promoted source and version on each platform, use the read-only
[Desktop release status](production-release.md#desktop-release-coverage) before
selecting a candidate.

Authorized production previews use a shareable public page at
`/desktop?candidate=<dmg-sha256>` and an immutable candidate download URL without
changing the default update channel. The plain `/desktop` page is the stable
account-free entry linked from the Web avatar menu. It shows an unavailable
state until a reviewed release is explicitly promoted.
Local private and disposable acceptance packages
retain their existing commands and must never be uploaded as production candidates.

After review, protected merge, and selection of the exact release SHA:

1. Use a clean checkout at that merged SHA and fetch `origin/main`. Export
   `OPENMELD_DESKTOP_RELEASE_SHA` as that full commit hash.
   For an optional read-only credential diagnostic before packaging, check the
   publisher with `openmeld-release/prd` credentials:

   ```sh
   doppler --silent run --project openmeld-release --config prd --only-secrets CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN --no-fallback -- node scripts/release/desktop-publisher.mjs
   ```

   It confirms the selected account and Desktop bucket with the named release
   token. This read check does not prove upload permission. The production
   package entry runs the same check before build and signing, so the separate
   diagnostic is not required. Upload and promotion require the same named token
   and pass it to Wrangler as `CLOUDFLARE_API_TOKEN`; neither command falls back
   to local Wrangler OAuth. Run those commands under the same Doppler wrapper,
   replacing the command after `--`. The production package entry removes the
   Cloudflare credentials from its signing child process.

2. Run the production package command once with the release credentials:

   ```sh
   doppler --silent run --project openmeld-release --config prd \
     --only-secrets CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN \
     --no-fallback -- pnpm desktop:package:production-preview
   ```

   The installed pipeline owns the production renderer artifact check: it
   builds or reuses the exact renderer and runs the Workerd SSR check. Do not
   run a separate manual Web build, reuse a disposable marker, or edit generated
   metadata. The pipeline
   validates the production target, rejects test settings and mixed signing
   credentials, and uses the existing company Developer ID and
   `openmeld-notary` Keychain profile. It requires the exact clean merged source.
   The signed App includes `desktop-production-source.json` with its source SHA,
   renderer fingerprint, and production target.
   On a native macOS host with sufficient admitted memory, the measured release
   recipe uses the same credential wrapper with measured memory overrides:

   ```sh
   OPENMELD_RENDERER_NODE_HEAP_MB=5120 OPENMELD_LOCAL_HEAVY_GIB=6 \
     doppler --silent run --project openmeld-release --config prd \
       --only-secrets CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN \
       --no-fallback -- pnpm desktop:package:production-preview
   ```

   Keep normal resource admission enabled. This is a macOS packaging budget,
   not a replacement for the bounded Linux runner defaults.
3. Verify the signed App, DMG copy and update ZIP: strict signature, stapled ticket,
   macOS trust, identity, resource equality, final hash and size. Review the
   artifact before the authorized publisher runs
   `pnpm release:desktop-preview:upload-candidate` from the same release checkout.
4. Deploy the additive Web candidate/feed readers before uploading a candidate
   with ZIP metadata; older strict metadata readers cannot read the new field.
   The uploader verifies the actual DMG's production identity, ticket, version
   and signed source record, and checks that the ZIP seals the same signed App.
   It uploads both artifacts before their immutable candidate manifest. Existing
   public candidates cannot be overwritten. It never promotes a release.
5. Verify public HEAD for both artifacts. Download the public DMG, check its
   hash and size, then use it for normal macOS install and production smoke
   through user-facing entrypoints. Do not separately download the full update
   ZIP here; the promotion command verifies both public artifacts. An upload
   alone does not prove availability or application behavior.
6. Separately authorize promotion. Deploy the Web feed/download readers first,
   then run from the same clean approved checkout:
   `OPENMELD_DESKTOP_RELEASE_SHA=<sha> node scripts/release/desktop-preview.mjs promote <candidate-hash> <current-version-or-none>`.
   The command verifies remote candidate metadata and hashes both public artifacts.
   It then reads the authoritative R2 pointer and candidate directly through Wrangler, checks the expected current
   version and strict version increase, and writes `desktop/promoted.json`
   last. This one atomic object replacement selects the public download, legacy
   JSON and generated `latest-mac.yml` together. Never upload builder-generated
   latest metadata or edit a parallel default manifest. Verify all three public
   projections after promotion. Public page/JSON/feed caches never authorize a
   promotion. A rollback is a reviewed forward release with
   a newer app version; do not downgrade the channel under installed clients.

The fixed storage contract in `packages/schemas/src/desktop-release.ts` uses:

- URL: `https://openmeld.ai/desktop/download?candidate=<dmg-sha256>`
- Metadata: `desktop/candidates/<dmg-sha256>/manifest.json`
- Artifact: `desktop/candidates/<dmg-sha256>/OpenMeld-Desktop-<version>-macos-arm64.dmg`
- Update artifact: the same candidate directory with a `.zip` extension
- Sole promoted pointer: `desktop/promoted.json`
- Generated updater feed: `/desktop/updates/latest-mac.yml`

Only a lowercase 64-character SHA-256 selects a candidate. Metadata must match
that hash and declares the production target, platform, version, merged release
SHA, and positive byte length. Artifact names and object keys are derived rather
than accepted from a request or stored arbitrary path. The content hash names
immutable bytes; retries may upload only that same verified artifact and record.
The Worker streams through its existing private `OPENMELD_DESKTOP_DOWNLOADS`
binding; no public bucket or additional access gate is introduced.

The legacy unsigned build can still be used locally, but its upload command is
disabled. Candidate publication does not change the promoted selection. The
old editable `desktop/update.json` storage object is no longer read; its public
URL is a compatibility projection of the promoted candidate. Existing DMG-only
candidate URLs remain valid but cannot be promoted into the updater channel.
Production deployment and ordering still follow
[Production Release](production-release.md); this workflow grants no independent
permission to deploy or publish.

### Native Windows Desktop candidates

The approval, clean merged source, scoped Web build, immutable upload, public
verification, and explicit promotion rules above also apply to Windows. Mac pointers/projections remain unchanged. Windows uses one
reviewed pointer per `windows-x64` or `windows-arm64`, never a Mac fallback.

Use `pnpm desktop:package:production-preview` on native Windows with
`OPENMELD_DESKTOP_RELEASE_SHA` set to the full approved merged SHA and
`OPENMELD_DESKTOP_WINDOWS_PUBLISHER` set to the actual certificate's publisher
name or full subject DN. Supply operator-owned credentials through supported
electron-builder Windows signing mechanisms. Optional
`OPENMELD_DESKTOP_WINDOWS_CERTIFICATE_SHA1` selects an exact installed certificate;
`OPENMELD_DESKTOP_ARCH` selects `x64` or `arm64`. The script does not create a
certificate, guess identity or bypass signature checks. The signed source record
additionally binds platform and publisher.

The package is `clients/desktop/dist/production-preview/OpenMeld-Desktop-<version>-windows-<arch>.exe`.
Inspection requires full 7-Zip (`7z.exe`, including NSIS support), discovered
under Program Files or selected with the absolute `OPENMELD_DESKTOP_7ZIP` path.
The release owner verifies the installer and its embedded signed application
without executing installation; sidecars are not proof of signed source.
Unsigned disposable acceptance uses the existing disposable target and
`pnpm desktop:package:installed`. It cannot exercise production auto-update or
be published. Preinstall the fixed candidate CLI for pre-release Computer smoke;
production bootstrap intentionally targets the published npm stable channel.

After separate publication authorization, use the existing root
`pnpm release:desktop-preview:upload-candidate`. After review, installed Windows
acceptance, additive Web deployment and separate promotion authorization, use
`pnpm release:desktop-preview:promote -- <candidate-sha256> <expected-current-version-or-none>`.
Windows root pnpm invocations preserve the exact pnpm JS entry; a direct release
script call without that entry fails instead of executing shell text. The shared
Git-backed `web` production lease and monotonic version check remain mandatory.

Windows metadata and installer share `desktop/candidates/<installer-sha256>/`.
The sole platform pointer is `desktop/promoted-windows-<arch>.json`. The page and
default download take `?platform=windows-<arch>`; immutable candidate links remain
hash-selected. The feed is `/desktop/updates/windows-<arch>/latest.yml` and its
payload is `/desktop/updates/<installer-sha256>/windows-<arch>.exe`.

Deploy platform-aware Web readers before these manifests. Verify page, GET,
HEAD, complete digest/size, platform feed and installed A-to-B behavior separately.
Real signed NSIS extraction, normal-user installation, ARM64 execution and the
actual OpenMeld signature/SmartScreen outcome remain native release acceptance,
not facts established by plan/PE tests or process-contract CI. GUI update/uninstall
must leave independently running Service and Wake work untouched. No feature PR
validation grants release authorization.

## Local Components Release Tool

Three local components release with the CLI package: the OpenMeld CLI command
contract, the OpenMeld Service bundle and execution contract, and the
OpenMeld-managed Skills under `clients/openmeld-cli/skills`.

A pull request that changes any of them bumps `clients/openmeld-cli/package.json`
and writes one decision per changed component in
`release/local-components-policy.json`:

```json
{
  "version": "0.3.265",
  "cli": { "updatePolicy": "available", "reason": "Adds the routine list command." },
  "service": { "updatePolicy": "required", "reason": "Changes the Wake execution contract." }
}
```

`pnpm run verify:release-ready` checks this from the changed paths. It passes
when no local-component path changed or the package version is already on npm,
and otherwise requires the bump and a decision for every changed component.
Hashes are computed at publish time from the built package and compared with
the published `cli/local-components.json`; never write them by hand. When no
Service-owned input changed, the publisher keeps the published Service version
and artifacts and verifies them before it moves the channel manifest.

Current early-release policy:

- `available` means a newer local component is available and current Wake work
  can continue. `required` is the only policy that blocks the affected
  capability, and needs the matching floor (`openmeld.minRequiredCliVersion` or
  `MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION`).
- A CLI command, Service runtime, or Skills contract change must be `required`;
  other changes can be `available`.

Skills release is artifact intent, not a user-store repair step. Running
`openmeld skills update` only updates the user's local skills store such as
`~/.openmeld/skills`; it does not change the published release manifest or the
running OpenMeld Service bundle.

The pre-push release check runs strict release readiness only when a push
includes `refs/heads/main`, a tag, malformed input, or no input. Ordinary
development pushes skip it.

This tool is release workflow, not product authority. Runtime readiness,
Service health, Space truth, and Wake execution truth remain owned by their
normal contracts.

## Database Workflow

The shared product database is PostgreSQL. Use the single
[PostgreSQL workflow](postgresql.md) for local setup, generation, native
migration history and acceptance. Root `db:check`, `db:generate` and `db:studio`
use `packages/db/postgresql/drizzle.config.ts`. Run connection-dependent local
commands inside the documented isolated PostgreSQL cluster.

Production database changes use the guarded scoped release owner in
[Production Database Release](production-release.md#production-database-release).
Shared staging uses its own PostgreSQL target through the guarded
`pnpm staging:deploy` workflow, including migrations and runtime grants.

Historical D1 files remain immutable import/recovery evidence; see
[the historical migration directory](../../packages/db/drizzle/README.md).
Data ownership and projections remain in
[data-and-observability.md](../architecture/data-and-observability.md).

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

Before the handoff, stop only this worktree's no-longer-needed dev stack. Keep
it running when the handoff explicitly needs live localhost state, and state
that fact instead of leaving an invisible background owner.

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
