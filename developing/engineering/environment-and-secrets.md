# Environment And Secrets

## Agent Context

- Purpose: Define how OpenMeld developers and coding agents obtain local
  environment secrets from the OpenMeld Doppler projects, how secret ownership
  is divided, and where local development stops before production authority
  begins.
- Read this when: You need to start OpenMeld locally, create or use a worktree,
  diagnose a missing environment value, add or move a secret, onboard a
  contributor, or assess Doppler production readiness.
- Update this when: Doppler projects or configs, the shared development secret
  allowlist, local environment commands, optional capabilities, or production
  secret handoff rules change.
- Do not use this for: Secret values, temporary migration inventories,
  deployment approval, Cloudflare binding topology, or production incident
  output.
- Source of truth: This file owns the OpenMeld Doppler project model used by the
  current OpenMeld repository and the human/agent-operable local secret
  workflow. The machine-readable allowlists live in
  `scripts/dev/doppler-environment.mjs`.

## Start In One Minute

A new contributor or coding agent needs [Node 24](https://nodejs.org/en/download),
the repository-pinned pnpm 10, and a Doppler account with access to the OpenMeld
Doppler projects. After installing Node, enable Corepack and install the exact
pnpm version declared in `package.json`:

```bash
corepack enable
corepack install
```

Install the Doppler CLI by following
[Doppler's official installation guide](https://docs.doppler.com/docs/install-cli).

On a new computer, install the toolchain and CLI, then authenticate once with
`doppler login`. Do not run `doppler configure` for this repository: the
checked-in wrapper selects every project and config explicitly, so the same
commands work in every worktree.

```bash
pnpm install --frozen-lockfile
pnpm dev:doctor
pnpm dev:worktree
```

The last command starts the Docker-free isolated Web/Worker development stack
with Remote Agent Sandbox-specific tools disabled. This is the normal path
when those tools are not under test. In a second terminal in the same worktree,
start Web with the same environment:

```bash
pnpm dev:web:worktree
```

The first Web page load can take about one minute while Web and Cloudflare
compile. Keep the page open. Later loads should be fast; this first-load delay
does not mean startup failed.

Use the URLs printed by the isolated launcher. Each worktree gets separate
ports, Worker persistence, and `OPENMELD_HOME`, but all authorized worktrees use
the same Doppler `dev` configs. No `.dev.vars` copy or per-worktree Doppler setup
is required.

When the task specifically tests Remote Agent Sandbox, container, shell, or
file tools, replace `pnpm dev:worktree` with
`pnpm dev:worktree:sandbox` and start Docker first. The normal shared Doppler
workflow does not otherwise require Docker.

The recommended commands describe the developer's goal rather than their
implementation:

| Command | Meaning |
| --- | --- |
| `pnpm dev:help` | Show the recommended commands and the Docker boundary. |
| `pnpm dev:doctor` | Check Doppler access, required values, and local shadow files without printing values. |
| `pnpm dev:worktree` | Start the worktree-specific Worker stack with shared Doppler `dev` values. This is the normal Docker-free path. |
| `pnpm dev:web:worktree` | Start Web in a second terminal and attach it to the live Worker stack in the same worktree. |
| `pnpm dev:worktree:sandbox` | Start the same Worker stack with Remote Agent Sandbox tools enabled. Docker is required. |
| `pnpm dev:stop` | Stop OpenMeld development processes in this checkout. Use `pnpm dev:stop -- --dry-run` to inspect targets first. |

The older `pnpm dev:isolated` and fixed-port commands remain available for
compatibility and specialized debugging. They are implementation-level
interfaces, not the newcomer workflow.

## The Model

The current OpenMeld repository uses OpenMeld Doppler projects divided by
deployable and security boundary rather than putting every value in one
project.

| Doppler project               | Owner                                                |
| ----------------------------- | ---------------------------------------------------- |
| `openmeld-web`                | Web runtime                                          |
| `openmeld-auth`               | Auth Worker and OAuth clients                        |
| `openmeld-core`               | Core integrations and credential-encryption keys     |
| `openmeld-gateway`            | Gateway OAuth callbacks and connector administration |
| `openmeld-remote-agent`       | Remote Agent model and connector runtime access      |
| `openmeld-open-connector`     | OpenConnector deployment                             |
| `openmeld-release`            | Release, signing, and infrastructure credentials     |

The first five projects feed the local OpenMeld stack. OpenConnector and
release credentials are never injected into ordinary local development.

Use configs as follows:

- `dev`: shared, least-privilege values required for normal local development.
- `dev_personal`: exceptional personal overrides. The standard runner does not
  load this config.
- `stg`: shared staging values. Local development does not load it.
- `prd`: production values. Only the read-only production doctor or an
  explicitly authorized release path may read it.

`scripts/dev/doppler-environment.mjs` is the single machine-readable source for
which secret names each local component may receive. The runner uses explicit
project and config flags, requests only those names, disables local fallback
files, and never downloads or prints values.

The top-level development supervisor receives no managed secrets. Each runtime
requests its own allowlisted values only when that runtime starts:

| Local runtime | Doppler projects it can read |
| --- | --- |
| Web | `openmeld-web` |
| Auth/Core Wrangler process | `openmeld-auth`, `openmeld-core` |
| Gateway | `openmeld-gateway` |
| Remote Agent | `openmeld-remote-agent` |

Auth and Core share one Wrangler process, so that process receives both
projects. Web, Gateway, and Remote Agent do not receive each other's managed
secrets. `pnpm dev:doctor` also checks one project at a time instead of building
one process with all values.

Remote Agent local and development traffic uses the checked-in
`openmeld-remote-agent-prod` AI Gateway id because Cloudflare Provider Keys are
gateway-scoped. The shared `openmeld-remote-agent` Doppler project supplies the
account-scoped gateway token and the configured `openrouter` BYOK alias; it does
not copy the OpenRouter provider key into a local file or Worker environment.
Worker-environment and Organization metadata keep requests attributable.

## Shared Development And Optional Capabilities

`pnpm dev:doctor` proves three things without printing values:

1. the Doppler CLI can read every required `dev` config;
2. every required value is non-empty;
3. no package-local `.dev.vars`, `.env`, or `.env.local` file would shadow
   Doppler.

The shared baseline intentionally excludes two privileged capabilities:

- `GITHUB_OPENMELD_API_TOKEN`: public GitHub metadata reads fall back to the
  anonymous rate limit when it is absent;
- `OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN`: connector administration is unavailable when it
  is absent, while ordinary local startup and connector runtime execution still
  work.

Do not copy a production token into shared `dev` merely to remove an optional
warning. Add a dedicated least-privilege development credential only when the
team needs that capability.

The Lark credential-encryption key in `dev` is a development-only key. Never
reuse the production key across environments. Local isolated databases do not
contain production encrypted credentials.

## Existing Checkouts During The Migration

Ordinary `pnpm dev` remains compatible with legacy package-local `.dev.vars`
files. This prevents the Doppler pilot from breaking the primary human
checkout.

`pnpm dev:worktree`, `pnpm dev:web:worktree`, and
`pnpm dev:worktree:sandbox`, however, fail before startup if a package-local
`.dev.vars`, `.env`, or `.env.local` exists. Cloudflare gives those files
precedence over process-injected values, so continuing would make the source of
a secret ambiguous. The command lists file paths only; it never reads, deletes,
moves, or prints their contents.

For a new worktree, ignored secret files are absent by default, so the Doppler
path works immediately. For an older checkout, keep using the legacy command or
move the files aside yourself before opting into Doppler.

## Safety Rules

- Never run `doppler secrets`, `doppler secrets download`, `printenv`, `env`, or
  shell tracing in logs that an agent or CI system can capture unless the exact
  command is explicitly designed to show names only.
- Never put a Doppler token, secret value, generated `.env`, `.dev.vars`, or
  certificate private key in Git, an issue, a PR, agent context, or `dev-tmp/`.
- Use the recommended `pnpm dev:*worktree` commands instead of hand-building a
  multi-project `doppler run` chain. The wrapper pins `dev` and an allowlist.
- Do not add `dev_personal`, `stg`, or `prd` to the standard local runner.
- A missing required value fails closed. Do not replace it with a placeholder.
- Treat certificate issuer API credentials as managed secrets, but keep
  Cloudflare-managed edge certificates and non-exportable signing private keys
  with their owning platform or signer.
- Store OAuth application client secrets in Doppler. Store per-user or
  per-installation runtime refresh tokens in the product's encrypted runtime
  data store, not in Doppler configs.

OpenConnector is an upstream runtime boundary. Doppler owns its credentials
under the canonical `OPEN_CONNECTOR_OPENMELD_*` names, while the unmodified
upstream Worker reads `OOMOL_CONNECT_*`. The guarded production deploy maps
the admin token, runtime token, encryption key, GitHub App id, and GitHub App
private key in memory at the child process boundary. For a new Worker, the
deploy sends Wrangler an in-memory JSON payload through `/dev/stdin`; it never
writes a secret file. The GitHub App private key is deployment-wide App
identity, not a member or Organization connection credential. Do not duplicate
the same values under both names in Doppler, and do not weaken or fork the
upstream runtime contract merely to match OpenMeld's credential catalog.

## Production Boundary

Production remains a separate authority and release action.

```bash
pnpm env:doctor:prod
```

This command performs a read-only, value-redacted readiness check across the
five production Worker configs. It exits non-zero and lists names when required
values are missing. It never writes Cloudflare secrets, dispatches GitHub
Actions, deploys a Worker, migrates a database, or makes the current branch a
release source.

During the migration:

- Doppler `dev` is the shared source for the opt-in local workflow;
- existing Cloudflare Worker secret storage and guarded repository release
  commands remain the production delivery path;
- production is not switched to Doppler until the production doctor is green,
  each component has a narrowly scoped non-human credential, secret sync has a
  reviewed fail-closed implementation, and the guarded release flow proves one
  component end to end.

Future CI should use one read-only service token scoped to one Doppler project
and config per deployment job. Do not give one deployment token access to all
OpenMeld Doppler projects. Keep secret synchronization explicit and separate
from ordinary deploys so deletion, drift, and rotation remain reviewable.

Production deployment order, immutable source requirements, database safety,
health checks, and real-user smoke remain owned by
`developing/engineering/production-release.md`. Cloudflare secret declaration
and synchronization rules remain owned by `docs/cloudflare-workers-env.md`.

## Adding Or Moving A Secret

### OpenMeld Credential Naming

Every newly created OpenMeld credential uses this canonical code-key shape:

```text
<PLATFORM>_OPENMELD_<PURPOSE>
```

Derive an external platform credential slug mechanically from that code key:

1. convert it to lowercase;
2. replace underscores with hyphens;
3. append the external environment suffix.

For example:

```text
ZEP_OPENMELD_API_KEY
-> zep-openmeld-api-key-prod

CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN
-> cloudflare-openmeld-release-api-token-prod
```

External platforms use `dev`, `stg`, and `prod`. Doppler configs continue to
use `dev`, `dev_personal`, `stg`, and `prd`; Doppler `prd` maps explicitly to
external `prod`.

Do not put the environment in the code key. The selected Doppler config is the
environment selector:

```text
ZEP_OPENMELD_API_KEY       # correct
ZEP_OPENMELD_API_KEY_PROD  # incorrect
```

Existing `OPENMELD_*` and provider environment-variable names are transitional
legacy contracts. Do not rename them opportunistically. The complete OpenMeld
environment-variable migration belongs to the product rebrand change and must
add a retired-identifier check at that time. Any credential or environment
variable first introduced before that migration must already follow the
OpenMeld naming contract above.

1. Identify the deployable that consumes the value and use its Doppler project.
2. Decide whether the value is shared `dev`, exceptional `dev_personal`,
   staging, or production. Do not duplicate it across configs without a real
   runtime need.
3. Update the Worker `secrets.required` contract and examples when the Worker
   contract changes.
4. Update the allowlist in `scripts/dev/doppler-environment.mjs` only when
   ordinary local development should receive the value.
5. Run `pnpm dev:doctor`, the focused environment tests, and the Cloudflare
   environment contract verification.
6. If Wrangler configuration changed, follow the type-generation sequence in
   `docs/cloudflare-workers-env.md`.
7. Change production only through a separately authorized guarded release.

If the old platform cannot return an existing value, do not invent one. Decide
whether it is safe to create an environment-specific replacement or whether a
coordinated rotation and data re-encryption plan is required.
