# Cloudflare Workers Environment Governance

## Agent Context

- Purpose: Define Cloudflare Worker environment, secret, binding, and production
  synchronization ownership for this repository.
- Read this when: You change Worker variables, secrets, bindings, generated
  Worker types, or the workflows and scripts that publish them.
- Update this when: A Worker environment contract, resource owner, sync script,
  or production workflow changes.
- Do not use this for: Product semantics, application runtime contracts, local
  secrets, deployment incident logs, or one-off operator output.
- Source of truth: This file owns Cloudflare Worker environment governance and
  the package/resource matrices below.

Official references:

1. [Cloudflare Workers: Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
2. [Cloudflare Workers: Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
3. [Cloudflare Workers: Environments](https://developers.cloudflare.com/workers/wrangler/environments/)
4. [Cloudflare Workers: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
5. [Cloudflare Vite plugin: Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)
6. [Cloudflare D1: Get started](https://developers.cloudflare.com/d1/get-started/)
7. [Cloudflare Resource Tagging: Manage tags](https://developers.cloudflare.com/resource-tagging/how-to/manage-tags/)
8. [Cloudflare Resource Tagging: Supported resource types](https://developers.cloudflare.com/resource-tagging/reference/resource-types/)

## Rules

1. Non-sensitive configuration belongs in `wrangler.jsonc` `vars` and `env.prod.vars`.
2. Sensitive values belong in the approved Doppler process-injection path or local `.dev.vars` / `.dev.vars.prod` for local work, and in Cloudflare Worker secret storage for production.
3. This repo uses `.dev.vars.prod`, not `.dev.vars.production`, because the Wrangler environment name is `prod`.
4. `wrangler.jsonc` is the source of truth for public Worker config. Do not hand-maintain production vars in the Cloudflare dashboard.
5. Secret sync is explicit. Production secret changes do not happen through deploy; they happen through `sync:secrets:prod`.
6. Every Cloudflare Worker package must provide `cf-typegen`, `sync:config:prod`, and `sync:prod`.
7. Every Worker package that owns secrets must also provide `sync:secrets:prod`.

For a brand-new OpenMeld account surface, Core, Auth, and Remote Agent form a
Service Binding cycle, while Gateway and Web need stable identities before
production secrets can be staged. Before the first real Worker release, run
`pnpm cloudflare:bootstrap:worker-identities -- --apply` with the release token.
The command creates only missing, route-free Worker identities that return a
diagnostic `503`; it never overwrites an existing Worker. The guarded production
release then replaces those placeholders with the real Workers.
8. After any Worker env, bindings, or `wrangler.jsonc` change, upgrade shared Wrangler first, then rerun `cf-typegen` for every Worker package.
9. New Cloudflare resources may be created with the local Wrangler CLI, but they
   are not integrated until the owning `wrangler.jsonc`, this document, and
   generated Worker types are updated.

## Package Matrix

### `clients/web`

- `wrangler.jsonc` `vars` / `env.prod.vars`
  - `OPENMELD_GATEWAY_URL`
  - `WEB_APP_URL`
  - `BETTER_AUTH_URL`
  - `VITE_BETTER_AUTH_URL`
  - `VITE_APP_TITLE`
- `.dev.vars` / `.dev.vars.prod`
  - `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`
- Cloudflare production secrets
  - `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`
- Scripts
  - `pnpm -C clients/web run cf-typegen`
  - `pnpm -C clients/web run sync:secrets:prod`
  - `pnpm -C clients/web run sync:config:prod`
  - `pnpm -C clients/web run sync:prod`

### `services/auth`

- `wrangler.jsonc` `vars` / `env.prod.vars`
  - `BETTER_AUTH_URL`
  - `WEB_APP_URL`
  - `AUTH_WORKER_NODE_ENV`
  - `AUTH_DEVICE_ALLOWED_CLIENT_IDS`
  - `OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED`
  - `AUTH_BRAND_NAME`
  - `AUTH_FROM_EMAIL`
  - `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID`
  - `GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID`
  - `AUTH_COOKIE_DOMAIN`
  - `PASSKEY_RP_ID`
  - `AUTH_MAGIC_LINK_EXPIRES_IN_SECONDS`
- `.dev.vars` / `.dev.vars.prod`
  - `BETTER_AUTH_OPENMELD_SECRET`
  - `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`
- Cloudflare production secrets
  - `BETTER_AUTH_OPENMELD_SECRET`
  - `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`
- Resource bindings
  - `OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER` for per-IP join-link
    acceptance admission at 10 requests per 60 seconds
- Scripts
  - `pnpm -C services/auth run cf-typegen`
  - `pnpm -C services/auth run sync:secrets:prod`
  - `pnpm -C services/auth run sync:config:prod`
  - `pnpm -C services/auth run sync:prod`

### `services/core`

- `wrangler.jsonc` `vars` / `env.prod.vars`
  - `CORS_ORIGINS`
  - `OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED`
  - `OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS`
  - `OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT`
  - `OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED`
  - `OPENMELD_LARK_CHANNEL_ENABLED`
  - `OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS`
  - `OPENMELD_FEISHU_CHANNEL_ENABLED`
  - `OPENMELD_FEISHU_CHANNEL_ORGANIZATION_IDS`
  - `OPENMELD_GATEWAY_URL`
  - `OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED`
  - `OPENMELD_ROUTINE_ENGINE_DEFAULT`
  - `OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS`
- Local and production set `OPENMELD_LARK_CHANNEL_ENABLED=true` and
  `OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS=*`, which keeps Lark setup visible and
  available to every Organization in both product environments. Feishu remains
  disabled in both environments. A Lark connection is not reported connected
  until its application configuration, Event Subscription URL, and Message
  Card Request URL pass the Core-owned connection checks.
- Local and production set
  `OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED=true`. Production was
  enabled only after every serving Core version could read the
  destination-neutral subscription shape and execute its supported
  destinations. Set production back to `false` to stop new destination-neutral
  writes during rollback; Core continues reading both continuation shapes.
- `wrangler.jsonc` `workflows` / `env.prod.workflows`
  - `OPENMELD_ROUTINE_RUN_WORKFLOW` binds the `openmeld-routine-run` Workflow
    to `RoutineRunWorkflow`
- `.dev.vars` / `.dev.vars.prod`
  - `GITHUB_OPENMELD_API_TOKEN`
  - `SLACK_OPENMELD_BOT_TOKEN`
  - `SLACK_OPENMELD_TOKEN_CRYPTO_KEY`
  - `LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY`
  - `ZEP_OPENMELD_API_KEY`
- Cloudflare production secrets
  - `GITHUB_OPENMELD_API_TOKEN`
  - `SLACK_OPENMELD_BOT_TOKEN`
  - `SLACK_OPENMELD_TOKEN_CRYPTO_KEY`
  - `LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY`
  - `ZEP_OPENMELD_API_KEY`
- Resource bindings
  - `OPENMELD_ORGANIZATION_SKILLS` stores private, immutable Organization Skill
    release bundles after Core authorizes the Organization-scoped mutation
  - `OPENMELD_SPACE_ATTACHMENTS` stores provider image bytes and immutable
    Space file revision bytes only after Core
    verifies the exact Message Channel connection, conversation, and
    Organization member
  - `OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE` consumes and
    redrives verified Lark and Feishu event envelopes
- Live Lark or Feishu app configuration requires `OPENMELD_GATEWAY_URL` to be
  a public HTTPS Gateway origin. The checked-in local value keeps normal local
  routing aligned, but a tunnel or shared dev Gateway override is required
  before a real provider can deliver Webhooks.
- Scripts
  - `pnpm -C services/core run cf-typegen`
  - `pnpm -C services/core run sync:secrets:prod`
  - `pnpm -C services/core run sync:config:prod`
  - `pnpm -C services/core run sync:prod`

### `services/remote-agent`

- `wrangler.jsonc` `vars` / `env.prod.vars`
  - `OPENMELD_WORKER_ENVIRONMENT`
  - `OPENMELD_CONNECTORS_BASE_URL`
  - `OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID`
  - `OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID`
  - `OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS`
  - `OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID`
  - `OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED`
  - `OPENMELD_AGENT_ACTIVITY_DIGEST_MODEL_ID`
  - `OPENMELD_FEEDBACK_SUBMIT_BASE_URL`
  - `OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY`
- `.dev.vars` / `.dev.vars.prod`
  - `CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN`
  - `OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN`
- Cloudflare production secrets
  - `CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN`
  - `OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN`
- Scripts
  - `pnpm -C services/remote-agent run cf-typegen`
  - `pnpm -C services/remote-agent run sync:secrets:prod`
  - `pnpm -C services/remote-agent run sync:config:prod`
  - `pnpm -C services/remote-agent run sync:prod`

### `services/gateway`

- `wrangler.jsonc` `vars` / `env.dev.vars` / `env.prod.vars`
  - `OPENMELD_CONNECTORS_BASE_URL`
  - `OPENMELD_GATEWAY_URL`
  - `GITHUB_OPENMELD_APP_SLUG`
  - `OPENMELD_SLACK_OAUTH_REDIRECT_URL`
  - `WEB_APP_URL`
- `.dev.vars` / `.dev.vars.prod`
  - `SLACK_OPENMELD_OAUTH_CLIENT_ID`
  - `SLACK_OPENMELD_OAUTH_CLIENT_SECRET`
  - `SLACK_OPENMELD_SIGNING_SECRET`
  - `OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN`
- Cloudflare production secrets
  - `SLACK_OPENMELD_OAUTH_CLIENT_ID`
  - `SLACK_OPENMELD_OAUTH_CLIENT_SECRET`
  - `SLACK_OPENMELD_SIGNING_SECRET`
  - `OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN`
- Resource bindings
  - `OPENMELD_IMAGES` for bounded image inspection, canonical 512 x 512
    identity-image transformation, and transient Center Agent model derivatives
  - `OPENMELD_ACCOUNT_AVATARS` for versioned public Account avatar objects
  - `OPENMELD_ORGANIZATION_LOGOS` for versioned public Organization logo
    objects
  - `OPENMELD_SPACE_ATTACHMENTS` for private Space attachment objects and
    immutable Space file revision objects
  - `OPENMELD_SPACE_PASSWORD_RATE_LIMITER` for per-IP and per-Space password
    admission at 10 requests per 60 seconds
  - `OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE` durably accepts only
    Core-verified Lark and Feishu event envelopes
- Scripts
  - `pnpm -C services/gateway run cf-typegen`
  - `pnpm -C services/gateway run sync:secrets:prod`
  - `pnpm -C services/gateway run sync:config:prod`
  - `pnpm -C services/gateway run sync:prod`

## Resource Binding Matrix

This matrix records Cloudflare resource ownership. Keep it in sync with
`wrangler.jsonc` files and generated `worker-configuration.d.ts` files.

| Resource type | Binding | Owner | Config files | Notes |
| --- | --- | --- | --- | --- |
| D1 | `OPENMELD_DB` | The single production D1 (Auth owns identity tables; Core owns business, dispatch, integration, and memory tables) | `services/auth/wrangler.jsonc`, `services/core/wrangler.jsonc` | Greenfield production database `openmeld-db-prod`. All shared-schema migrations live in `packages/db`; provisioning never applies them. |
| D1 | `OPENMELD_IDENTITY_DB` | Auth identity alias | `services/auth/wrangler.jsonc` | Aliased to `openmeld-db-prod`; no second physical identity database exists. |
| D1 | `OPENMELD_LOCAL_STATE_DB` | Binding / devices / sessions / diagnostics alias | `services/core/wrangler.jsonc` | Aliased to `openmeld-db-prod`; reads route there via `localStateDb()`. |
| D1 | `OPENMELD_WAKE_EVIDENCE_DB` | Dispatch Ledger / observability alias | `services/core/wrangler.jsonc` | Aliased to `openmeld-db-prod`. A future observability-only split is a separate capacity decision, not greenfield provisioning behavior. |
| D1 | `OPENMELD_PROJECTIONS_DB` | Space Index alias | `services/core/wrangler.jsonc` | Aliased to `openmeld-db-prod`; reads route there via `projectionsDb()`. |
| KV | `OPENMELD_AUTH_KV` | Auth | `services/auth/wrangler.jsonc` | Auth worker runtime storage. |
| Queue | `OPENMELD_DAEMON_DISPATCH_QUEUE` | Core Dispatch | `services/core/wrangler.jsonc` | Production Queue `openmeld-daemon-dispatch-prod`; four-day retention. |
| Queue | `OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE` | Gateway producer and Core consumer | `services/gateway/wrangler.jsonc`, `services/core/wrangler.jsonc`, generated Worker types | Production Queue `openmeld-message-channel-events-prod`; four-day retention. Gateway acknowledges Lark/Feishu only after enqueue; Core owns retry, redrive, ingress claims, and Center Agent admission. |
| Workflow | `OPENMELD_ROUTINE_RUN_WORKFLOW` | Core Center Agent Routine execution | `services/core/wrangler.jsonc`, `services/core/worker-configuration.d.ts` | Production Workflow `openmeld-routine-run-prod` binds `RoutineRunWorkflow`; D1 remains the Routine and Run product truth. Wrangler creates it with the first Core deployment. |
| Worker vars | `OPENMELD_ROUTINE_ENGINE_DEFAULT`, `OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS` | Core Center Agent Routine engine selection | `services/core/wrangler.jsonc`, `services/core/worker-configuration.d.ts` | Workflow is the normal default. The global `legacy` value or an Organization override affects only newly claimed Runs; an existing Workflow-owned Run never crosses engines. |
| Durable Object | `OPENMELD_SPACES` | Core Space domain | `services/core/wrangler.jsonc` | Space truth and message state. |
| Durable Object | `OPENMELD_RUNTIME_TRANSPORT` | Core runtime transport hub | `services/core/wrangler.jsonc` | Low-latency runtime transport and Wake delivery. |
| Durable Object | `FLUE_CENTER_AGENT_AGENT`, `FLUE_REGISTRY` | Remote Agent Flue runtime | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/worker-configuration.d.ts` | Hosted Center Agent conversation instances and the Flue registry. |
| Durable Object and Container | `SANDBOX`, `Sandbox` | Remote Agent Cloudflare Sandbox | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/Dockerfile`, `services/remote-agent/worker-configuration.d.ts` | Each admitted submission receives an isolated Cloudflare Sandbox container through Flue's official adapter. The Docker image version must match `@cloudflare/sandbox`; no host or user-workstation mount is configured. |
| Browser Run | `BROWSER` | Remote Agent rendered web tools | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/worker-configuration.d.ts` | Stateless Quick Actions provide rendered Markdown, links, structured extraction, selector scraping, and screenshots. `remote: true` is required for local Wrangler development. The current runtime has no retained browser session, Live View, or human takeover surface. |
| Worker Loader | `LOADER` | Remote Agent stateless Code Mode | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/worker-configuration.d.ts` | `DynamicWorkerExecutor` runs model-generated JavaScript that can compose only the exact tools active for the current submission. The generated Worker receives no OpenMeld secrets or bindings, and `globalOutbound: null` blocks direct outbound networking. This binding does not add the durable Code Mode runtime, history, snippets, tool discovery, or approval replay. |
| AI Gateway | `OPENMELD_REMOTE_AGENT_AI_GATEWAY_*` vars and `CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN` secret | Remote Agent model execution | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/.dev.vars.example`, `services/remote-agent/.dev.vars.prod.example` | Local, development, and production route through the configured gateway `openmeld-remote-agent-prod` because Cloudflare Provider Keys are gateway-scoped. Request metadata retains the Worker environment and Organization boundary; a second empty gateway must not masquerade as an isolated environment. The gateway uses the OpenRouter BYOK alias `openrouter`, and no secret override may replace the checked-in gateway id. Every ordinary Center Agent turn uses the frozen primary route carried by admission; the worker does not substitute a second model for Task or Space requests. |
| Worker vars | `OPENMELD_FEEDBACK_SUBMIT_BASE_URL`, `OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY` | Remote Agent preset Feedback reporting | `services/remote-agent/wrangler.jsonc`, `services/remote-agent/worker-configuration.d.ts` | Production points to the ordinary public Gateway submit route and official inbox. Local and dev defaults are empty so reporting fails closed until an explicit local inbox is supplied. |
| Worker var and secret | `OPENMELD_CONNECTORS_BASE_URL`, `OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN` | Gateway connection management | `services/gateway/wrangler.jsonc`, generated Worker types, and Gateway `.dev.vars*.example` | The URL is non-secret. The admin token is restricted to connection administration and is never returned to Web, Core, tool results, or diagnostics. |
| Worker var | `GITHUB_OPENMELD_APP_SLUG` | Gateway GitHub App installation start | `services/gateway/wrangler.jsonc`, generated Worker types | Production uses the Organization-owned `openmeld-ai` GitHub App. Gateway builds the public installation URL from this code-owned slug and Core's opaque state; clients and model input never supply an App slug. |
| Worker var and secret | `OPENMELD_CONNECTORS_BASE_URL`, `OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN` | Remote Agent approved action execution | `services/remote-agent/wrangler.jsonc`, generated Worker types, and Remote Agent `.dev.vars*.example` | OpenConnector runtime routes reject the admin token. The runtime token is scoped to action execution and is never returned to Core, tool results, or diagnostics. |
| Worker var | `OPENMELD_GATEWAY_URL` | Environment-specific Gateway public origin | `clients/web/wrangler.jsonc`, `services/gateway/wrangler.jsonc`, generated Worker types | Web sends Gateway requests to this origin, and Gateway uses the same configured origin for durable public Organization logo URLs instead of trusting the incoming request Host. |
| Analytics Engine | `OPENMELD_OBSERVABILITY` | Shared runtime evidence projection | `clients/web/wrangler.jsonc`, `services/auth/wrangler.jsonc`, `services/core/wrangler.jsonc`, `services/gateway/wrangler.jsonc`, `services/remote-agent/wrangler.jsonc` | Production dataset `openmeld_runtime_evidence_prod`, created on first write. Compact historical Cloudflare runtime evidence for the shared observability contract. |
| Images | `OPENMELD_IMAGES` | Gateway identity-image processing and Remote Agent model-input derivatives | Gateway and Remote Agent Wrangler configs and generated Worker types | Gateway calls `info()` before identity-image transformation, rejects invalid or oversized dimensions, and emits one non-animated 512 x 512 WebP object. Remote Agent streams one authorized R2 source at a time into Images, prefers a 2560-pixel WebP, keeps a 1600-pixel readability floor and 4 MiB per-image ceiling, and sends at most five images, 8 MiB of derivative bytes, and an estimated 20 megapixels per auxiliary model request. Larger turns are split into ordered auxiliary batches and merged into one primary-model turn. The derivative never replaces the Space File revision or enters persistent conversation history. Local and `dev` Wrangler environments use the documented remote binding because the image transformation service does not run locally. |
| Rate Limit | `OPENMELD_ORGANIZATION_JOIN_LINK_ACCEPT_RATE_LIMITER` | Auth join-link acceptance | `services/auth/wrangler.jsonc`, `services/auth/worker-configuration.d.ts` | Limits each source IP to 10 authenticated join-link acceptance requests per 60 seconds. The binding is an admission guard and does not own membership truth. |
| Rate Limit | `OPENMELD_SPACE_PASSWORD_RATE_LIMITER` | Gateway protected Space reads | `services/gateway/wrangler.jsonc`, `services/gateway/worker-configuration.d.ts` | Limits each source IP and Space pair to 10 password-bearing anonymous read requests per 60 seconds before Core password verification. Core remains the password authorization owner. |
| R2 | `OPENMELD_ORGANIZATION_LOGOS` | Gateway Organization logo bytes | `services/gateway/wrangler.jsonc`, `services/gateway/wrangler.test.jsonc`, `services/gateway/worker-configuration.d.ts` | Production bucket `openmeld-organization-logos-prod`; preview/dev bucket `openmeld-organization-logos-preview`. Objects use immutable versioned keys and contain no source upload or private metadata. |
| R2 | `OPENMELD_ACCOUNT_AVATARS` | Gateway Account avatar bytes | `services/gateway/wrangler.jsonc`, `services/gateway/wrangler.test.jsonc`, `services/gateway/worker-configuration.d.ts` | Uses the existing production and preview Organization-logo buckets under a separate `profiles/{profileId}/avatars/` key namespace; no new Cloudflare resource is required. Objects are immutable normalized WebP output and contain no source upload or private metadata. |
| R2 | `OPENMELD_ORGANIZATION_SKILLS` | Core Organization Skill release bundles | `services/core/wrangler.jsonc`, `services/core/wrangler.test.jsonc`, `services/core/worker-configuration.d.ts` | Production bucket `openmeld-organization-skills-prod`; preview/dev bucket `openmeld-organization-skills-preview`. Core is the only writer and reads exact immutable release objects only after Organization authorization. D1 owns identity, enabled state, permissions, provenance, and the active-release pointer. |
| R2 | `OPENMELD_SPACE_ATTACHMENTS` | Gateway, Core, and Remote Agent private attachment bytes plus immutable Space file revision bytes | Gateway, Core, and Remote Agent Wrangler configs and generated Worker types | Production bucket `openmeld-space-attachments-prod`; preview/dev bucket `openmeld-space-attachments-preview`. Gateway serves authenticated, Space-authorized reads and writes. For Space Files, the owning Space Durable Object authorizes the actor, validates optimistic concurrency, and returns the exact immutable object scope before Gateway stores bytes. After exact Message Channel connection, conversation, and Organization-member authorization, Core downloads bounded provider images, validates JPEG/PNG magic bytes, and stores deterministic transient objects. Remote Agent reads those inputs and removes transient objects only after admission succeeds. Remote Agent also writes Browser Run screenshots only after Core creates scoped attachment metadata; callback publication revalidates the descriptor. |
| Service binding | `OPENMELD_AUTH_WORKER` | Core -> Auth | `services/core/wrangler.jsonc` | Core calls Auth through service binding. |
| Service binding | `OPENMELD_REMOTE_AGENT_WORKER` | Core -> Remote Agent | `services/core/wrangler.jsonc` | Core submits hosted Center Agent turns through the shared Remote Agent RPC contract. |
| Service binding | `OPENMELD_CORE_WORKER` | Remote Agent -> Core | `services/remote-agent/wrangler.jsonc` | Remote Agent binds the private `CenterAgentRpcEntrypoint` for sequenced Space stream snapshots, terminal turn callbacks, and Core-backed Center Agent product tools. Core owns authorization, durable result publication, and product-data tenancy. The historical `CenterAgentRoutineRpcEntrypoint` export remains only for already-deployed binding compatibility. |
| Service binding | `OPENMELD_AUTH_WORKER` / `OPENMELD_CORE_WORKER` | Gateway -> Auth/Core | `services/gateway/wrangler.jsonc` | Gateway public ingress to internal services. |

## Add Or Change A Cloudflare Resource Binding

Use this flow for D1, KV, R2, Queues, Durable Objects, service bindings,
Hyperdrive, Vectorize, Workers AI, and other Worker bindings.

1. Re-check the current Cloudflare docs for the resource and the current
   Wrangler config schema at `node_modules/wrangler/config-schema.json`.
2. Create or inspect the resource with the local Wrangler CLI when the resource
   lives in Cloudflare.
3. Update the owning package `wrangler.jsonc`, including the relevant `env`
   block such as `env.prod`.
4. Update this document's package matrix or resource binding matrix.
5. Update the owning package README if the local developer workflow changed.
6. Run the standard refresh sequence.
7. Sync production config or secrets only when the change is ready for
   production.

Named Queues are provisioned explicitly before the first production Worker
deployment that references them:

```bash
pnpm exec wrangler queues create <queue-name>
```

The guarded CLI, Gateway, and Core production release lanes read the Queue names
from each owning Worker's `env.prod` configuration and verify that every Queue
exists before an irreversible CLI publication or Worker deployment begins.
This live preflight does not create production infrastructure automatically.
Missing resources fail with the exact provisioning command so resource
creation remains an intentional operator action.

Plain English:

- creating a resource in Cloudflare is not enough
- `wrangler.jsonc` is what binds that resource to a Worker
- generated `worker-configuration.d.ts` is what makes TypeScript know the
  binding exists
- this document is what lets future agents know who owns the binding

### Provision OpenMeld Greenfield Account Resources

`scripts/cloudflare/provision-openmeld-resources.mjs` is the idempotent source
of truth for account resources that must exist before a production Worker is
deployed. Its default mode is read-only. `--apply` creates only missing exact
names, then verifies each resource ID by listing it again. It does not deploy a
Worker, apply a D1 migration, or attach a domain.

The manifest owns these resources:

- Zone and DNS: active zone `openmeld.ai` plus the four proxied Custom Domain
  AAAA records for Web, Auth, Gateway, and Open Connector. The script rediscovers
  DNS record IDs from their exact hostname and Cloudflare-managed `100::` shape.
- Workers: `openmeld-web-prod`, `openmeld-auth-prod`, `openmeld-core-prod`,
  `openmeld-gateway-prod`, `openmeld-remote-agent-prod`, and
  `openmeld-open-connector-prod`. The script requires these deployment-managed
  identities to exist and never creates placeholder Worker code. It also
  discovers every version serving the newest deployment and tags it with the
  owning Worker ID required by Cloudflare.
- Durable Object namespaces: the three active Core namespaces and three active
  Remote Agent namespaces. The script discovers their stable IDs by exact
  namespace name and never creates namespaces outside a Worker deployment.
- D1: `openmeld-db-prod`, `openmeld-open-connector-db-prod`
- KV: `openmeld-auth-kv-prod`
- R2 production: `openmeld-space-attachments-prod`,
  `openmeld-organization-skills-prod`, `openmeld-organization-logos-prod`,
  `openmeld-desktop-downloads-prod`,
  `openmeld-open-connector-transit-files-prod`
- R2 preview: `openmeld-space-attachments-preview`,
  `openmeld-organization-skills-preview`,
  `openmeld-organization-logos-preview`
- Queues: `openmeld-daemon-dispatch-prod`,
  `openmeld-message-channel-events-prod`
- AI Gateway: `openmeld-remote-agent-prod`

Run it only through the Doppler release project. The account ID is non-secret;
the API token must remain process-injected and must never be printed or written
to a file:

```bash
CLOUDFLARE_ACCOUNT_ID="<account-id>" \
  doppler run --project openmeld-release --config prd \
  --only-secrets CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN \
  --no-fallback --silent -- sh -c \
  'CLOUDFLARE_API_TOKEN="$CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN" \
  node scripts/cloudflare/provision-openmeld-resources.mjs --apply'
```

The same script reconciles these case-sensitive Cloudflare Resource Tagging
keys with `GET -> merge -> PUT -> GET`: `product`, `environment`, `owner`,
`managed-by`, `component`, `data-class`, and `repository`. `PUT` replaces all
tags, so do not bypass this merge flow. Cloudflare currently documents a beta
behavior where the first `GET` for an untagged resource can return 500; the
script handles only that documented case as an empty tag set.

As of 2026-08-12, all manifest resources exist, their IDs round-trip through
their product list APIs, and their tags pass the script's post-write verification.
The release token has account-level Tag Read and Tag Write access. Use the same
idempotent command for later reconciliation; do not create duplicate resources
or substitute names in the Dashboard.

### Provision Organization Logo Resources

Create the versioned-object buckets once per Cloudflare account before the
Gateway config that references them is deployed:

```bash
pnpm -C services/gateway exec wrangler r2 bucket create openmeld-organization-logos-prod
pnpm -C services/gateway exec wrangler r2 bucket create openmeld-organization-logos-preview
```

Cloudflare Images does not need a separately named bucket. The
`OPENMELD_IMAGES` binding is declared in every Gateway and Remote Agent
environment because Wrangler does not inherit Images bindings into named
environments. After a binding change, refresh and verify the generated
contract:

```bash
pnpm -C services/gateway run cf-typegen
pnpm -C services/remote-agent run cf-typegen
pnpm run verify:cloudflare:env-contract
```

Do not place an R2 access key in Gateway secrets. The Worker binding is the
only storage credential used by this path.

After provisioning, deploy this feature in dependency order: Auth, Gateway,
then Web. Gateway depends on the additive Organization logo Auth RPC, and Web
depends on the Gateway upload route. Keep that mixed-version window short.

### Add Or Change A D1 Database

D1 has two separate concerns:

- Cloudflare resource and Worker binding ownership
- database schema and migration ownership

Required flow:

1. Re-check the current Cloudflare D1 and Wrangler docs.
2. Create the database with the local Wrangler CLI when a new Cloudflare D1 DB
   is needed.
3. Add the D1 binding to the owning Worker's `wrangler.jsonc` and the relevant
   `env` block.
4. Record the DB domain owner, allowed writers, read consumers, and migration
   owner in this document or the data-layer docs.
5. If this is a shared OpenMeld D1 schema change, use the root `db:*` commands from
   [packages/db/README.md](../packages/db/README.md), not package-local ad hoc
   commands.
6. Run `pnpm cf-typegen` and include regenerated
   `worker-configuration.d.ts` files in the change.

Observability bindings are also part of the Worker environment contract. Every
runtime Worker should keep:

- Workers Logs enabled.
- Workers Traces enabled.
- `OPENMELD_OBSERVABILITY` bound to `openmeld_runtime_evidence_prod` in
  production and `openmeld_runtime_evidence` in local/dev environments.
- `OPENMELD_WORKER_ENVIRONMENT` set in top-level `vars` and every named environment.

Cloudflare runtime evidence uses the shared schema in
`packages/schemas/src/schemas/http/observability-runtime-event.ts`. Analytics
Engine stores only the compact historical projection, so its text dimensions
must stay within Cloudflare's physical column limit and should prioritize the
main Wake diagnosis chain over incidental request metadata. Run
`pnpm run verify:observability` after changing runtime evidence schemas,
Analytics Engine field order, Diagnostic Report query tooling, OpenMeld trace
Cloudflare hints, or Worker runtime evidence emitters.

Use `pnpm ops:cf:query` for historical Analytics Engine lookup and
`pnpm ops:cf:tail` for live `wrangler tail` streams. Historical support work
should start from OpenMeld durable trace or `pnpm ops:diagnostic-report`, then pivot
to Cloudflare evidence with the same correlation IDs.

Do not casually change production `database_id`. Treat production D1 binding or
database changes as migration events that need a rollback and validation plan.

## Standard Refresh Sequence

Run this whenever you change Worker env names, bindings, `wrangler.jsonc`, or
`secrets.required`.

1. Update the shared Wrangler version in [pnpm-workspace.yaml](../pnpm-workspace.yaml).
2. Run `pnpm install`.
3. Run `pnpm cf-typegen`.
4. Commit the updated `worker-configuration.d.ts` files.
5. Sync production config or secrets as needed:
   - public config: `pnpm -C <package> run sync:config:prod`
   - secrets: `pnpm -C <package> run sync:secrets:prod`

If the change touches runtime evidence fields, Analytics Engine bindings, or
Cloudflare diagnostic tooling, also run `pnpm run verify:observability`.

## Common Operations

### Add or change a public variable

1. Update the package `wrangler.jsonc` `vars` and `env.prod.vars`.
2. Update package docs or example files if the developer workflow changed.
3. Run the standard refresh sequence.
4. Run `pnpm -C <package> run sync:config:prod`.

### Add or change a secret

1. Update `secrets.required` in the package `wrangler.jsonc`.
2. Update `.dev.vars.example` and `.dev.vars.prod.example`.
3. Update package docs and GitHub workflow inputs if needed.
4. Run the standard refresh sequence.
5. Put the real production value into `.dev.vars.prod` locally or create a temporary `.dev.vars.prod` file in CI.
6. Run `pnpm -C <package> run sync:secrets:prod`.

### Generate or recover a production secret

Use this decision rule first:

1. If the secret only protects cookies or sessions and it is acceptable to invalidate existing client state, you may generate a new value.
2. If the secret is used to decrypt data that is already stored on the server, do not generate a new value unless you are intentionally doing a coordinated rotation.
3. Cloudflare Worker secret storage does not let you read an existing secret value back out in plaintext, so production secrets must also be kept in an operator-controlled source of truth outside the repo, such as a secure password manager or CI secret manager.

#### `clients/web`: `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`

- Purpose:
  - Protects the encrypted `openmeld_space_access_*` cookie used for protected space access.
- Safe rule:
  - You may generate a new value for a new environment at any time.
  - You may also rotate it in an existing environment if you accept that existing protected-space-access cookies will stop working and users may need to enter the space password again.
- Recommended generation command:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

- Where to put it:
  - local prod source of truth: `clients/web/.dev.vars.prod`
  - remote prod secret storage: `pnpm -C clients/web run sync:secrets:prod`

Example:

```dotenv
WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET="paste-a-32-byte-random-base64url-secret-here"
```

#### `services/core`

Core owns production secrets for hosted Center Agent integrations:

- `GITHUB_OPENMELD_API_TOKEN`
- `SLACK_OPENMELD_BOT_TOKEN`
- `SLACK_OPENMELD_TOKEN_CRYPTO_KEY`
- `LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY`
- `ZEP_OPENMELD_API_KEY`

`GITHUB_OPENMELD_API_TOKEN` authenticates only the bounded GitHub REST metadata
reads used to import public Organization Skills. It prevents all OpenMeld
tenants from sharing GitHub's anonymous per-IP request budget. It is never
stored in a Skill release, returned to clients, or sent to the model.

`SLACK_OPENMELD_TOKEN_CRYPTO_KEY` and
`LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY` must each be a base64-encoded
32-byte AES key. They protect separate credential domains and must not share a
value.
Generate a new environment's value with:

```bash
openssl rand -base64 32
```

Do not rotate an environment's key without a credential re-encryption plan;
existing per-workspace Slack tokens must remain decryptable. The global Slack
bot token is a compatibility fallback only when a workspace has no stored
credential.

The retired `START_SPACE_CHOICE_PAYLOAD_SECRET` belonged to the old
StartSession space-choice flow and must not be reintroduced for Prepare Session
setup.

#### Practical operator flow

1. If the package is `clients/web`, generate a fresh secret with the command above unless you intentionally want to preserve existing cookies.
2. If the package is `services/core`, recover the existing production secret first. Do not generate a replacement by default.
3. Save the value into the package-local `.dev.vars.prod`.
4. Run that package's `sync:secrets:prod`.
5. If you intentionally rotated a secret, record the decision and user impact in the deployment notes.

### Delete a public variable

1. Remove it from code and `wrangler.jsonc`.
2. Run the standard refresh sequence.
3. Run `pnpm -C <package> run sync:config:prod`.

### Delete a secret

1. Remove it from code, `secrets.required`, and `.dev.vars*.example`.
2. Run the standard refresh sequence.
3. Delete it from Cloudflare with `wrangler secret delete`.

### Recover from dashboard drift

1. Public config drift: redeploy with `sync:config:prod`.
2. Secret drift: sync the secret with `sync:secrets:prod`.

## Local Development

1. The preferred shared path uses `pnpm dev:worktree` and `pnpm dev:web:worktree`. The top-level supervisor receives no managed secrets; each Web or Worker process requests only its component allowlist from Doppler. Wrangler automatically loads names declared by `secrets.required` from that component-scoped process environment when no local env file takes precedence.
2. Legacy default local Worker env files use `.dev.vars`. The normal development commands continue supporting them during the migration.
3. Prod-like local Worker env files use `.dev.vars.prod`.
4. If `.dev.vars.prod` exists for `--env prod`, Wrangler does not merge `.dev.vars` into that environment.
5. Do not split the same Worker env contract across `.dev.vars*` and `.env*`.
6. The Doppler wrapper fails when a package-local `.dev.vars`, `.env`, or `.env.local` would shadow process-injected values. See `developing/engineering/environment-and-secrets.md` for the operator and agent workflow.

## GitHub Workflows

Production workflows intentionally reuse package scripts.

- Production dispatchers:
  - [release-on-main.yml](../.github/workflows/release-on-main.yml) selects one
    Worker/database scope by default; `cloud` and `full` are explicit.
  - [cli-release.yml](../.github/workflows/cli-release.yml) publishes CLI/Core
    by default; its `full` rollout is explicit.

- Secret sync workflows:
  - [sync-auth-worker-secrets.yml](../.github/workflows/sync-auth-worker-secrets.yml)
  - [sync-web-worker-secrets.yml](../.github/workflows/sync-web-worker-secrets.yml)
- Deploy workflows:
  - [deploy-auth-worker.yml](../.github/workflows/deploy-auth-worker.yml)
  - [deploy-core-worker.yml](../.github/workflows/deploy-core-worker.yml)
  - [deploy-gateway-worker.yml](../.github/workflows/deploy-gateway-worker.yml)
  - [deploy-remote-agent-worker.yml](../.github/workflows/deploy-remote-agent-worker.yml)
  - [deploy-web.yml](../.github/workflows/deploy-web.yml)

The workflow contract is:

1. Secret workflows create a temporary `.dev.vars.prod` file and call `sync:secrets:prod`.
2. Component deploy workflows check out one captured release SHA, run the
   component's scoped release verification, call `sync:config:prod` once, and
   perform a lightweight post-deploy health check.
3. Component workflows share the cached pnpm setup action. They do not run D1
   migrations or `PRAGMA optimize`.
4. Database scopes call the single `db:release:prod` sequence before their
   selected Worker. Normal component deploys never call it.
5. Web deploy creates a temporary `.dev.vars.prod` because the production build
   needs `WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET`.
6. Core, Gateway, and Remote Agent own production Worker secrets but do not yet
   have dedicated secret-sync workflows. Operators must supply the
   package-local `.dev.vars.prod` source and run that package's
   `sync:secrets:prod`; deploy does not sync those secrets.

GitHub reserves the `GITHUB_` prefix for Actions secrets. The Auth runtime
contract remains `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET`, while the
`production` Environment stores the same value under
`OPENMELD_GITHUB_AUTH_OAUTH_CLIENT_SECRET`; the Auth sync workflow maps that
transport-only name back to the runtime contract explicitly.

Production lane selection, scopes, ordering, database safety, smoke boundaries,
and release evidence are owned by
`developing/engineering/production-release.md`.

## Known Guardrails

1. `services/core` must not depend on an implicit `NODE_ENV`; Cloudflare Workers only expose what the Worker config or secret storage provides.
2. `clients/web` URL config is not secret. Keep it in `wrangler.jsonc`, not in Cloudflare secret storage.
3. Wrangler `secrets.required` currently emits an experimental warning in `wrangler` `4.82.0`. Use it as a contract guard, not as a replacement for real Cloudflare Worker secret storage.
