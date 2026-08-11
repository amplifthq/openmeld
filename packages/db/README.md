# OpenMeld Shared Database Layer

Operational guide for working in the OpenMeld data layer. Read it before changing
any D1 schema, migration, repo module, or DB-related workflow.

Boundary: this README is the how-to companion. Data ownership, projections,
writer rules, and observability truth are owned by
`developing/architecture/data-and-observability.md`; physical DB direction is
owned by `developing/architecture/physical-db-split.md`. If this file and an
owner document disagree, the owner document wins.

## Mental Model

1. Define the contract in `packages/schemas`.
2. Define the database truth in `packages/db`.
3. Expose domain-owned behavior from `services/auth` or `services/core`.
4. Aggregate read-only diagnostics in `services/gateway`.

The shared Cloudflare D1 binding is `OPENMELD_DB`. Auth and Core share that one
database, but each domain owns its own tables:

- Schema homes: `packages/db/src/auth/*` and `packages/db/src/core/*`,
  aggregated in `packages/db/src/schema.ts`.
- Committed migrations: `packages/db/drizzle` (see `drizzle/README.md` for the
  migration runbook). A second migration directory under a service is
  architecture drift.
- Auth-owned tables (examples): `accounts`, `sessions`, `users`, `openMeldProfiles`,
  `openMeldProfileSpaceHistory`.
- Core-owned tables (examples): `openMeldDaemonOpsDecisions`,
  `openMeldDaemonDispatchLedger`, `openMeldDaemonDispatchAttempts`,
  `openMeldDaemonDlq`, `openMeldDaemonDispatchResults`, and the operational
  `openMeldDaemonPreHeadFailurePublicationOutbox`. The outbox is recovery state;
  it must not be treated as time-decaying Wake evidence.
- Gateway owns no shared-DB business logic; `/v1/diagnostics/chain` is runtime
  diagnostics aggregation, not a second schema system.

Package roles in one line each:

- `packages/schemas`: shared request/response/diagnostics contracts — never
  table ownership or migrations.
- `packages/db`: shared D1 schema truth, migration truth, root `db:*` tooling,
  Better Auth generated output — never service-only logic.
- `packages/auth`: compatibility re-exports only — do not add new canonical
  schema definitions there.
- `services/auth` / `services/core`: domain runtime logic and repos — never a
  second schema source of truth or runtime schema self-heal.
- `services/gateway`: routing and diagnostics aggregation — never direct
  shared-D1 ownership.

## Daily Commands

Run shared D1 workflow from the repo root:

```bash
pnpm db:check        # does local shared DB state match committed truth
pnpm db:inspect:dev  # read-only migration readiness inspection
pnpm db:generate     # create a committed migration under packages/db/drizzle
pnpm db:migrate:dev  # apply committed migrations via Wrangler D1
pnpm db:verify:dev   # legacy-shape detection + physical-contract check
pnpm db:release:prod # clean generation gate + prod migrate + verify + optimize
pnpm db:studio       # open the current shared schema in Drizzle Studio
```

`pnpm db:sync:prod` is a compatibility alias to `db:release:prod`. Production
workflows and agents must use the single release implementation rather than
recreating its steps. Production scope selection and failure reporting are
owned by `developing/engineering/production-release.md`.

Service-local wrappers such as `pnpm -C services/auth run db:migrate:dev`
proxy to the same root gate; the repo root stays the owner. For normal
full-stack startup use `pnpm dev` and let the dev guard own the shared
`OPENMELD_DB` gate.

## Better Auth Code Generation

Better Auth-owned schema changes must start with code generation, never
hand-edits:

```bash
pnpm turbo run auth:generate --filter=@openmeld/db
# or: pnpm -C services/auth run auth:generate
```

The canonical generated file is `packages/db/src/auth/auth.schema.ts`. Do not
hand-edit or "clean up" generated output, even when it is not how you would
write it by hand. After generation, continue with the normal `db:*` workflow.
The CLI-only Better Auth config uses deterministic development settings and a
code-generation-only placeholder secret. Schema generation must never read or
require production Auth Worker secrets; the runtime entry point continues to
validate its bound `BETTER_AUTH_SECRET` strictly.

## How To Change Database Behavior

When you add or change a Cloudflare D1 binding (`wrangler.jsonc` owns the
Worker binding; `docs/cloudflare-workers-env.md` owns the resource workflow):

1. Re-check current Cloudflare D1 and Wrangler docs plus
   `node_modules/wrangler/config-schema.json`.
2. Create or inspect the Cloudflare DB with the local Wrangler CLI.
3. Update the owning Worker's `wrangler.jsonc` binding in top-level and
   relevant `env` config.
4. Update `docs/cloudflare-workers-env.md` with the binding owner and workflow
   impact.
5. If schema or migrations changed, use the root `db:*` commands.
6. Run `pnpm cf-typegen` and include `worker-configuration.d.ts` changes in the
   handoff evidence.

Production D1 binding or `database_id` changes are migration events, not
harmless config renames.

When you add a shared contract: schema first in `packages/schemas`, derive
types from it, test success/failure/boundary cases, and only then wire services
or CLI.

When you add an Auth-owned table or field:

1. Add the schema under `packages/db/src/auth/*` and update
   `packages/db/src/auth/schema.ts`.
2. If Better Auth owns the change, run `auth:generate` instead of hand-editing.
3. Run `pnpm db:check`, `pnpm db:generate`, `pnpm db:migrate:dev`,
   `pnpm db:verify:dev`.
4. Update Auth runtime logic and tests.

When you add a Core-owned table or field:

1. Add the schema under `packages/db/src/core/*` and update
   `packages/db/src/schema.ts`.
2. Run `pnpm db:check`, `pnpm db:generate`, `pnpm db:migrate:dev`,
   `pnpm db:verify:dev`.
3. Implement access through explicit Core repo modules only.
4. Update tests and direct validation.

## Non-Negotiable Rules

- No second shared D1 schema truth outside `packages/db`.
- No second committed migration directory outside `packages/db/drizzle`.
- No runtime schema self-heal, implicit schema patching, or silent DB fallback.
- `db:migrate:*` / `db:verify:*` do not repair arbitrarily stale local
  databases; reset or repair stale local state explicitly. Supported
  empty-state bootstrap (creating a missing local sqlite) is not stale-state
  repair — real legacy-shape or physical-contract drift must still fail fast.
- Do not swallow database errors; preserve context and fail fast.
- No direct shared D1 SQL in application-layer or transport-layer code; Core
  raw SQL lives in explicit repo modules.
- Non-owner modules must not read or write another domain's tables.
- Compare and synchronize DB truth only through the root `db:*` workflow.

## Validation Floor

Minimum for data-layer changes: `pnpm test`, `pnpm build`, `pnpm check`. Add
`pnpm test:integration` / `pnpm test:runtime` when the change touches
page-flow, CLI integration, or worker runtime. For live CLI/Core/Gateway/Auth
flows also run `openmeld-dev whoami --view agent` and
`pnpm run test:e2e:gateway:cli`; add `pnpm run test:e2e:auth:http` when
Auth-owned runtime paths changed.

## Read First (New To This Layer)

1. `packages/schemas/src/schemas/db/fact.ts`
2. `packages/db/src/schema.ts`
3. `packages/db/src/auth/schema.ts`
4. `packages/db/src/core/dispatch.schema.ts`
5. `packages/db/drizzle.config.ts`
6. `services/auth/src/lib/rpc/entrypoint.ts`
7. `services/core/src/space/infrastructure/d1/space-dispatch-read-repo.ts`
8. `services/gateway/src/routes/rpc-http.diagnostics.ts`
