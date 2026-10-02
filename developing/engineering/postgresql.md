# PostgreSQL Foundation And Migration Workflow

## Agent Context

- Purpose: Own the executable PostgreSQL development, migration, isolated cloud
  acceptance, backup/restore and future cutover workflow.
- Read this when: Implementing shared PostgreSQL persistence or operating its
  infrastructure. Architecture belongs to
  [physical-db-split.md](../architecture/physical-db-split.md); logical ownership
  remains in [data-and-observability.md](../architecture/data-and-observability.md).
- Source of truth: `tooling/postgresql/resources.json` owns the provisioned
  target inventory, `tooling/postgresql/wrangler.jsonc` owns the isolated probe,
  and `packages/db/postgresql/migrations` owns PostgreSQL schema history.
- This is not authorization to change production D1, cut over business data,
  deploy the main product, or alter OpenConnector's upstream database.
- Update this when: PostgreSQL tooling, credential ownership, migration gates, or recovery contracts change.
- Do not use this for: Business domain ownership, current D1 operations, or automatic production promotion.

## Current boundary

The 2026-10-03 decision is Hyperdrive + PlanetScale PostgreSQL for the shared
relational database. Existing production and shared staging continue on D1.
Foundation resources use distinct `openmeld-postgresql-stg` and
`openmeld-postgresql-prod` databases. The latter is an empty reserved destination,
not a running product database. Do not attach the probe to production.

The initial baseline contains an application schema, not a translation of the
existing business tables. Preserve all D1 schema/migration files and current
release commands until business adaptation and cutover are complete.

## Tools and local development

The staging, reserved production, and local/CI baseline is PostgreSQL 18. Use the current
provider-supported stable minor version; do not choose an older major merely
as a precaution without a concrete compatibility reason. The reserved production
destination is empty; its minimum machine is not a production capacity decision.
Choose production capacity and availability before any real business promotion.

PlanetScale's documented 17→18 path creates a new database rather than performing
an automated in-place major upgrade. An isolated synthetic foundation can replay
its baseline into that empty database, then revalidate roles, Hyperdrive and
restore behavior. Real data requires the reviewed logical migration workflow.
[Provider upgrade guidance](https://planetscale.com/blog/postgres-18-is-now-available).

Use repository-pinned Wrangler, `pscale` >=0.313.0 for Cloudflare billing, and
PostgreSQL 18 server/client tools. On macOS use the keg-only installation;
do not relink or start a global database service:

```sh
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install pscale postgresql@18
pnpm install --frozen-lockfile
pnpm pg plan
pnpm pg:check
pnpm pg:local run node tooling/postgresql/cli.mjs migrate local
```

`pg:local` creates a private temporary PG cluster, chooses a loopback-only port,
generates synthetic credentials, passes them only to its child, and stops and
removes only that cluster afterward. It never uses `~/.openmeld` or a system
database. Set `OPENMELD_PG_BIN` to a PostgreSQL 18 binary directory on other
platforms. `pg:local run <command> ...` provides a shell or tool with the scoped
connection variables for an interactive development session. There is no
remote reset command. A reset is a new local run.

Use `psql` with process-injected PG variables for SQL inspection. PlanetScale's
database dashboard provides query insights, connections, metrics and backups;
Cloudflare's Hyperdrive dashboard provides connection/query metrics. No extra
MCP server or broad database-agent credential is needed for this foundation.

## Schema and migration ownership

The migration owner uses a direct TLS connection (port 5432), never Hyperdrive
or PlanetScale's transaction pooler. `pg migrate staging` verifies the exact
registered hostname and branch identity before connecting. Production apply is
intentionally unavailable in the foundation CLI.

Create consecutive `000N_description.sql` files in the PostgreSQL migrations
directory. Review SQL explicitly; a future Drizzle PostgreSQL schema can generate
these files when actual business models are ported. Do not derive a PostgreSQL
baseline by replaying SQLite DDL or copying D1's migration ledger. SQL files must
be transaction-compatible and must not contain their own BEGIN/COMMIT. Concurrent
index builds require a separately reviewed execution step, not a silent exception.

The runner acquires a PostgreSQL session advisory lock on the direct connection,
compares the complete applied filename/checksum prefix, and commits each migration
with its ledger entry in one transaction. A second executor fails without applying
changes. A failed migration rolls back; changed or missing applied history blocks
further work. Statement and lock timeouts bound schema operations, not active
OpenMeld execution. Do not automatically retry an ambiguous committed write.

Review timestamp units and timezone, boolean conversion, JSON null vs SQL NULL,
collation/order, case sensitivity, parameter syntax, conflict/upsert behavior,
foreign keys, pagination, unique constraints, IDs and indexes at each business
owner. Test the real queries and transaction boundaries. Preserve public IDs,
DO identifiers, R2 keys and encrypted credential envelopes.

## Runtime connections and permissions

Use `pg` >=8.16.3 with Workers `nodejs_compat`. The foundation pins 8.23.1.
Create clients within a request and close them in `finally`; Hyperdrive owns
the origin pool. Start with 5 origin connections per isolated configuration.
The configured maximum is a soft limit; leave provider capacity for migrations,
monitoring and recovery. Measure before increasing it.

Application query caching is disabled. Hyperdrive does not invalidate cached
reads on writes. Keep a transaction on one client and use SET LOCAL for its
settings. Never rely on session settings or session locks across transactions.
Origin connection establishment is bounded; lost connections fail the operation.
Reconcile uncertain commit outcomes by domain idempotency keys before retrying.

Keep the operator/default provider role for provisioning only. Create a distinct
migration owner and a runtime role per environment. Runtime roles must have no
administrative attributes or broad inherited roles; grant only USAGE plus
SELECT/INSERT/UPDATE/DELETE on explicitly owned schemas/tables and required
sequence access. The migration ledger schema is inaccessible to runtime.
Default privileges belong to the actual object-creating role. Verify grants
again when changing migration ownership or restoring with a different owner.

Staging acceptance uses a separate synthetic `openmeld_probe.records` table.
It is not a business table and must never be provisioned in production. No
production data is copied to it. The probe requires a secret bearer token,
an exact environment marker and a finite expiry; it accepts only POST
`/acceptance`, no caller-supplied SQL. Remove the probe after cloud acceptance.

## Secret and deployment boundary

All commands explicitly target organization `amplift`; never use the personal
login's default organization. After a Cloudflare-billed database exists, use:

```sh
node tooling/postgresql/cloud.mjs inventory staging
node tooling/postgresql/cloud.mjs prepare staging
node tooling/postgresql/cloud.mjs hyperdrive staging
node tooling/postgresql/cloud.mjs migrate staging
node tooling/postgresql/cloud.mjs grant-runtime staging
node tooling/postgresql/cloud.mjs accept staging
node tooling/postgresql/audit.mjs
pnpm --filter @openmeld/postgresql cf-typegen
node tooling/postgresql/verify.mjs
node tooling/postgresql/probe.mjs deploy
node tooling/postgresql/probe.mjs check <returned-workers.dev-url>
node tooling/postgresql/probe.mjs cleanup
```

`prepare` creates roles only once and refuses existing names rather than rotating
credentials. `hyperdrive` refuses duplicate names. Inventory and inspect custody
before resuming partial provisioning. Only `inventory`, `prepare`, and `hyperdrive`
accept the reserved `production` target; production prepare never applies schemas.
Run inventory-changing cloud commands sequentially. Review and renew the finite
probe expiry before a later acceptance run. Its deploy checks the live cache and
origin settings and records the deployed version plus source content hash.

The cloud scripts inject only the requested credential through process memory.
They do not export an entire Doppler environment or put URLs in shell arguments.
Remove temporary bootstrap roles once preparation is validated.

Use `openmeld-release/stg` and `openmeld-release/prd` for infrastructure and
migration credentials; environment selection remains explicit. New keys follow
`POSTGRESQL_OPENMELD_MIGRATION_URL`, `POSTGRESQL_OPENMELD_RUNTIME_URL`, and
`POSTGRESQL_OPENMELD_PROBE_TOKEN`. Runtime URL storage is for credential custody;
Workers receive only the Hyperdrive binding, never the migration URL. Add no PG
secrets to ordinary shared local development. Future business Workers get their
own narrow runtime roles at business adaptation time.

Cloudflare billing signatures are credentials. Pass signature JSON to
`pscale database create ... --engine postgresql --cloudflare-billing @-` via
stdin, never print or persist it. The Cloudflare account must first activate
PlanetScale billing; accepting its legal terms is a human action. PlanetScale
authentication is independent. Inventory by exact org/database/name before create.
If the billing-signature command reports authorization failure, use the official
Cloudflare dashboard creation path and verify `cloudflare_billed` plus the exact
account ID with `cloud.mjs inventory`. Do not infer billing authorization from
successful Hyperdrive access or silently switch to personal-card billing.

The isolated probe's guarded deploy must validate target IDs, cache-disabled
Hyperdrive config, source identity, token and expiry. It has no custom routes,
D1/DO/R2 bindings or main-product service bindings. Record a content hash for
the authorized uncommitted foundation source, separate from merged/released
product evidence. Do not call the shared staging or production release to test it.

## CI and promotion

The path-filtered `.github/workflows/postgresql-foundation.yml` installs PG18
from the official PostgreSQL apt repository and runs the same isolated checks.
It never receives Doppler, PlanetScale, or Cloudflare credentials.

Run the same `pnpm pg:check` locally and in CI with ephemeral PostgreSQL 18.
It exercises baseline, repeated application, upgrade with preserved data,
checksum drift, concurrency, rollback, runtime permission denial, database
isolation and actual pg_dump/pg_restore. CI has no provider or production
credentials. Hosted success can be claimed only after the workflow actually runs.

Staging order: provision isolated targets and least-privilege roles; apply
reviewed migrations once; verify grants and backups; deploy only the isolated
probe; run authenticated and unauthorized checks; record evidence and remove
the probe. Future product staging adaptation uses the existing guarded release
entrypoint after its owners explicitly support the new database contract.

Production promotion remains a separate scoped release through
[production-release.md](production-release.md). Before enabling it, add the
reviewed PG target to that existing control plane and its lease, rather than
creating a competing production deploy command. Require source identity,
successful upgrade/restore evidence, target-bound credentials, single migration
executor, mixed-version compatibility and explicit cutover authorization.

## Backup and restore

PlanetScale Postgres includes automatic backups every 12 hours, retained for
2 days, and WAL for the oldest retained backup window. Default backup storage
is twice allocated disk; excess compressed backup/WAL storage is currently
$0.023/GB-month. Verify the actual schedule and retention on each created branch.
Choose any longer production retention before real user-data cutover.

Provider restore creates a **new** isolated branch in the same region:

```sh
pscale backup create openmeld-postgresql-stg main --org amplift --name foundation-synthetic --format json
pscale backup list openmeld-postgresql-stg main --org amplift --format json
pscale backup restore openmeld-postgresql-stg foundation-restore-<date> <backup-id> --org amplift --cluster-size PS_5_AWS_ARM --replicas 0 --format json
```

Wait for successful backup/ready restore state before checking data. Restored
managed roles retain object ownership but get new passwords; provision/reset
credentials only on the new branch and recheck grants. Extensions are not
restored automatically. Validate synthetic marker, row counts, checksums and
runtime permissions before deleting the temporary restore branch. Branch compute
continues billing until deleted. Provider restore evidence is separate from the
local logical dump/restore test.

PITR restores between the oldest backup and about five minutes before now;
it is not zero-loss protection for an arbitrary latest write. Use a final
consistent backup during a controlled cutover freeze. `pg_dump`/`pg_restore`
must match or exceed the server major version and use direct TLS connections.
Restore to an empty independently named database, with `--exit-on-error` and
`--single-transaction`; restore roles/grants deliberately. Never restore over a
live target as part of routine verification.

## Future short-maintenance-window cutover

1. Adapt from current merged source; inventory every reader/writer, scheduled
   job, queue consumer, Auth/Core/Remote/Gateway dependency and retention task.
   Rehearse schema conversion and business flows with synthetic isolated data.
   Keep original D1 exports/history recoverable; define acceptable historical
   omissions explicitly. Freshness `expires_at` is not a retention cutoff.
2. Prove restores, least-privilege grants, tenant authorization, IDs, DO/R2
   references, encryption compatibility and final schema/query plans. Record
   exact source, bindings, backup IDs and a maximum maintenance window.
3. Announce maintenance; freeze every D1 business writer and ingress producer.
   Drain or explicitly stop/recover in-flight RuntimeCoordinator executions,
   Space outboxes and publication/recovery work. Do not infer empty queues from
   UI quietness. Coordinator remains execution authority throughout.
4. Take final D1 backup/export under the freeze. Import into the isolated PG
   destination with preserved IDs and a reviewed conversion ledger. Compare
   counts/checksums and sampled relationships, including DO and R2 references.
   Validate Auth, membership, permission, session, Space/Wake, Inbox and files.
5. Switch every relational reader/writer to one PostgreSQL authority through
   the guarded component release. Keep D1 frozen and recoverable. Do not enable
   prolonged dual writes or assume a cross-D1/PG atomic transaction exists.
6. Before PG accepts business writes, a failed acceptance can roll back all
   bindings/source together to the unchanged D1 snapshot. Once PG accepts new
   writes, rollback requires a new freeze and preserving/reconciling those
   writes into the chosen authority, or fixing forward. Simply pointing back
   to old D1 loses data and is prohibited. DO/R2 side effects need matching
   reconciliation; a database backup alone does not undo them.
7. Reopen writes only after business and operational acceptance. Observe
   connection pressure, query latency, failures, permission denials and backup
   health. Retire old D1 only in separately authorized cleanup after retention
   and recovery requirements are met.

## Official contracts

- [Cloudflare-billed PlanetScale creation](https://developers.cloudflare.com/hyperdrive/planetscale/)
- [Hyperdrive pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/),
  [caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
  [limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)
- [PlanetScale roles](https://planetscale.com/docs/postgres/connecting/roles),
  [backups](https://planetscale.com/docs/postgres/backups),
  [pricing](https://planetscale.com/docs/postgres/pricing)
