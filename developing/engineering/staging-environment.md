# Internal Staging Environment

## Agent Context

- Purpose: Define the reusable OpenMeld staging environment, its isolation
  boundary, and the commands that deploy and verify it.
- Read this when: You need to deploy or diagnose staging, test a cross-service
  change before production, or add a staging Cloudflare resource or secret.
- Update this when: Staging components, resource names, Doppler ownership,
  deploy ordering, public entry points, or verification commands change.
- Do not use this for: Production release authority, production data, local
  worktree development, or a feature-specific smoke script.
- Source of truth: This file owns the operator workflow and isolation contract
  for OpenMeld internal staging. Worker bindings remain owned by each
  `wrangler.jsonc`; Doppler allowlists live in
  `scripts/dev/doppler-environment.mjs`.

## What Staging Provides

Staging is a persistent, internal OpenMeld environment. It runs the same five
internal deployables as production:

- Web
- Auth
- Gateway
- Core
- Remote Agent

It has separate Cloudflare Workers, D1, KV, R2 buckets, Queues, Durable Object
namespaces, and container identity. Its public entry points are:

- `https://staging.openmeld.ai`
- `https://auth.staging.openmeld.ai`
- `https://gateway.staging.openmeld.ai`

Staging never reads or copies production user data. It does not share
production D1, KV, R2, Queues, Worker identities, Durable Object namespaces, or
runtime containers. A staging deploy must not publish the production CLI,
change a production Worker, or touch `~/.openmeld`.

Remote Agent model traffic is the narrow exception to resource isolation.
Staging uses the operator-managed `openmeld-remote-agent-prod` AI Gateway and
its `openrouter` Provider Key because Provider Keys are gateway-scoped and the
Organization has one OpenRouter key. Requests still carry the Staging Worker
environment and Organization metadata. The Remote Agent Worker, conversation
state, containers, and every OpenMeld-owned data store remain staging-only.

The first staging baseline intentionally omits peripheral parity. Slack, Lark,
Feishu, OpenConnector administration, production OAuth clients, billing, and
production email delivery are not required for the internal chain to be
deployable. Magic-link authentication is the initial human sign-in path.
Enable an omitted integration only when a concrete staging test needs it and a
separate staging credential exists.

### Staging Apps Backend

Slack acceptance uses the dedicated OpenMeld Staging Slack app, with HTTP events
at `https://gateway.staging.openmeld.ai/slack/events` and OAuth redirect
`https://gateway.staging.openmeld.ai/slack/oauth/callback`. Disable Socket Mode
for this HTTP receiver. Store its OAuth client ID, client secret, and signing
secret in Gateway's staging Doppler config, and a separate 32-byte base64 token
encryption key in Core's staging config. Never rotate an existing encryption
key as part of routine deployment.

Sync these opt-in credentials through each component's scoped staging Doppler
environment using `pnpm --filter @openmeld/gateway sync:secrets:slack:stg` and
`pnpm --filter @openmeld/core sync:secrets:slack:stg`. The baseline deploy remains
usable without Slack credentials. Complete the normal Web Slack connection
flow and restrict acceptance messages to the authorized test scope; creating
the Slack app alone does not establish an OpenMeld Organization connection.

OpenConnector has a separate opt-in deployment for Apps acceptance:
`https://connectors.staging.openmeld.ai`. Its Worker, D1 database and transit
file bucket are `openmeld-open-connector-stg`,
`openmeld-open-connector-db-stg` and
`openmeld-open-connector-transit-files-stg`. The checked-in configuration is
`config/openconnector/wrangler.staging.jsonc`. The action policy matches the
reviewed production policy, including read-only Google actions and blocked
generic proxies. Staging credentials never come from production.

From a clean OpenMeld checkout and a separate clean OpenConnector checkout:

```bash
pnpm deploy:openconnector:staging -- --source <checkout> --source-sha <full-sha>
```

The guarded entry point obtains only the release and OpenConnector `stg`
credentials, verifies the environment contract, provisions missing staging
resources, builds the exact external source, applies only its staging D1
migrations, deploys with secrets over stdin, and checks its public health.
The five canonical deployment secrets are owned by
`openmeld-open-connector/stg`; Gateway owns its administration-token copy and
Remote Agent owns its runtime-token copy. OAuth clients must use
`https://connectors.staging.openmeld.ai/oauth/callback` and independent staging
credentials. Provider authorization and real App actions remain separate
acceptance checks; a successful health response proves neither.

Gateway and Remote Agent point to that staging endpoint in their checked-in
configuration. Install the private GitHub App `openmeld-staging-flue2` only
on the authorized test repositories. After preparing each component's token
copy, sync it without exposing other components' credentials:

```bash
node scripts/dev/doppler-environment.mjs component:stg gateway -- pnpm --filter @openmeld/gateway sync:secrets:connectors:stg
node scripts/dev/doppler-environment.mjs component:stg remote-agent -- pnpm --filter @openmeld/remote-agent sync:secrets:connectors:stg
```

The optional inventory is included with
`provision-openmeld-resources.mjs --environment staging --include-open-connector`.
It does not make unfinished provider setup a prerequisite for baseline or
Remote Agent-only staging verification.

## Operate Staging

Use one guarded entry point from the repository root:

```bash
pnpm staging:plan
pnpm env:doctor:stg
pnpm staging:deploy
pnpm staging:deploy -- --scope web
pnpm staging:deploy -- --scope remote-agent
pnpm staging:verify
pnpm staging:cli:plan
pnpm staging:cli:publish
pnpm staging:cli:verify
pnpm staging:smoke:computer -- plan
```

- `staging:plan` prints the exact order and changes nothing.
- `env:doctor:stg` checks Doppler access and required names without printing
  values or changing Cloudflare.
- `staging:deploy` requires a clean worktree, creates only missing staging
  prerequisites, applies staging D1 migrations, deploys the five Workers, and
  verifies resources and public entry points.
  The Worker order is Auth, Core, Gateway, Web, then Remote Agent so stream
  readers understand new activity fields before the runtime emits them.
- `staging:deploy -- --scope web` and `--scope remote-agent` deploy one
  non-database Worker after verifying the existing Staging resources. Use these
  narrow paths for component-only changes so an unrelated Worker cannot block
  or enlarge the deploy. Database-backed component changes still use the full
  deployment.
- `staging:verify` is read-only. It verifies the checked-in environment
  contract, Doppler readiness, Cloudflare resource inventory, and public
  staging entry points.
- `staging:cli:plan` shows the exact source, isolated prerelease version,
  bucket, and manifest without changing anything.
- `staging:cli:publish` builds, signs, notarizes, and uploads a binary only to
  the staging R2 bucket. It uses a staging prerelease version so update tests do
  not wait for or publish a production version.
- `staging:cli:verify` reads the public staging manifest and rejects any
  Production artifact URL or non-staging version.
- `staging:smoke:computer -- plan` shows the repeatable Computer update smoke
  without changing local or Staging state.

Do not replace this workflow with raw `wrangler deploy`, Dashboard edits, or a
Production release command. A clean worktree makes the exact deployed commit
recoverable. If `origin/main` changes before deployment, resolve that change
and rerun the same gate from the final commit.

The Staging Computer uses the `canary` OS-service identity and
`~/.openmeld-canary`; its Setup and Service preserve
`https://staging.openmeld.ai/cli/manifest.json` as the only update source. This
keeps launchd registration and local state separate from the published
`openmeld` lane. Never point this lane at the Production manifest.

## Run The Computer Update Smoke

The Computer smoke is the reusable regression check for the highest-risk local
update path. Sign in to `https://staging.openmeld.ai` with a magic link and copy
a fresh Computer Setup command. Save that single command in a private file
outside the repository, then run:

```bash
chmod 600 /tmp/openmeld-staging-setup.txt
pnpm staging:smoke:computer -- run --setup-command-file /tmp/openmeld-staging-setup.txt
```

The runner accepts only the official Staging Canary binary Setup URL. It never
executes the copied line as arbitrary shell, never prints its one-time tokens,
and rejects Production, lookalike hosts, npm distribution, extra flags, and
shell suffixes. It temporarily preserves an existing `~/.openmeld-canary` only
when both Canary launchd labels are free, then restores that exact directory
after the run. The temporary smoke home uses private file token storage so the
packaged CLI and the source API helper share one disposable Staging credential;
the runner deletes that home before restoring the previous Canary state.
After the local process starts, the runner waits for Core's current-device
projection to observe the Service connection before it sends maintenance or
update commands.

One run verifies the focused update safety contracts, connects a temporary
Canary Computer, publishes a newer prerelease only to the Staging CLI channel,
waits for automatic update to start, sends a manual Update through the same
authenticated current-Computer API used by Web, and requires both requests to
return one operation ID. It then verifies the managed CLI, restarted Service,
and Staging Core all report the new version. Success output is a short list of
`PASS` lines. Failure output includes the failed step; cleanup failures preserve
their recovery directory under `dev-tmp/staging-computer-smoke/`.

## Run Work Coordinator Acceptance

The Work Coordinator V2 fixture is a small, persistent Staging scenario for
workstation Wake coordination. It provides one owner, one non-owner, two Codex
Agent Profiles on different models, two Spaces, and one Direct Message. Read
the non-secret IDs and direct Web entry points with:

```bash
pnpm staging:work-coordinator:summary
```

Fixture credentials live only in Doppler project `openmeld-staging-smoke`,
config `stg_smoke`. Recreate the two human identities without printing their
credentials with:

```bash
pnpm staging:work-coordinator:prepare-identities
```

That command is fixture preparation, not smoke evidence. Acceptance still uses
the listed Staging Web routes and a Staging-aligned Service with a fresh
temporary `OPENMELD_HOME`. Run the Service in the foreground or as a detached
process without registering an OS service. Never use `~/.openmeld`, stop a
published Service, or point the fixture at Production. The scenario is scoped
to workstation Wake, same-Profile FIFO across its two Spaces and Direct
Message, two-model collaboration, owner/member projections, Usage and
recovery, configuration revisions, and end-to-end timing. Add more fixture
surface only when the Work Coordinator acceptance actually needs it.

## Deployment Order

The guarded deployment order is intentional:

1. verify checked-in staging contracts;
2. verify the minimal Doppler values;
3. create missing staging account resources;
4. create missing route-free Worker identities;
5. apply migrations to `openmeld-db-stg`;
6. deploy Auth, Core, Remote Agent, Gateway, and Web;
7. verify the resource inventory and public entry points.

Worker identities exist before the real deploy because the internal Service
Bindings form a cycle. The bootstrap Workers have no routes and return a
diagnostic `503`; the guarded deploy replaces them with the real code.

Core receives runtime contracts before Remote Agent produces them, and Web
publishes new input metadata only after both backend receivers are deployed.
If a change requires Remote Agent's receiver before Core's sender, deploy the
compatible Remote Agent scope first, then run the full guarded deployment.

## Secrets And Authority

Staging uses only Doppler `stg` configs. The release credential is stored once
in `openmeld-release/stg`; component secrets stay in the component that owns
them. The staging launcher requests only the names required by one step and
maps the canonical OpenMeld release token to Cloudflare's CLI variable only at
the child-process boundary.

Creating or rotating a Cloudflare token, AI Gateway token, or Doppler secret is
an explicit operator action. Never put the value in Git, command output, a PR,
or a staging report. Staging credentials must be independently revocable and
must not reuse a Production deploy token.

## Evidence And Failure Handling

A successful deployment report must name:

- the exact Git commit;
- the `staging` environment;
- the contract and Doppler checks that passed;
- the D1 migration outcome;
- the five deployed Workers;
- the public entry points that returned success;
- any product flow that still needs a separate real-user smoke.

Resource-list commands, D1 inspection, and direct Worker calls are diagnostics,
not real-user smoke. Feature smoke must still use Web, a staging-aligned CLI or
Service, and the product-supported trace path. A failed step stops the guarded
deployment and keeps its error context; do not report partial deployment as a
working staging environment.

## Planned Test Layers

The staging platform is deliberately delivered in layers:

1. the internal Cloudflare environment and guarded deployment;
2. a staging-only CLI and OpenMeld Service update channel;
3. one repeatable regression smoke for Computer connection, automatic and
   manual update coordination, Service recovery, and Wake result safety.

The third layer is worth automating because every CLI or Service release can
regress the same critical product promise. Feature-specific tests remain
manual or focused automation; staging is not a mandate to build one giant test
for every product surface.
