# PostgreSQL Foundation And Migration Workflow

## Agent Context

- Purpose: Own the executable PostgreSQL development, migration, isolated cloud
  acceptance, backup/restore and controlled cutover workflow.
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

Production completed the authorized Hyperdrive + PlanetScale PostgreSQL cutover
on 2026-10-04. `openmeld-postgresql-prod` is the live shared relational authority,
with Hyperdrive query caching disabled. Shared staging reuses the existing
`openmeld-postgresql-stg` target through its own cache-disabled Hyperdrive.
Do not attach the foundation probe to production. Exact migration and delivery
evidence is in the [production cutover record](postgresql-cutover.md#current-production-state).
The production `status: ready-empty` field in `resources.json` is the historical
provisioning snapshot included in the certified database contract. It is not a
live database-state projection. Current production state comes from the verified
cutover and deployment receipts plus explicit resource readbacks. Changing that
file requires the normal database-contract release assessment, even for metadata.

The PostgreSQL journal now includes the shared product tables, Inbox's explicit
sequence and native Auth UUID defaults. Production Auth and Core use native
PostgreSQL SQL and one Hyperdrive binding. Preserve immutable D1 history and the
frozen source. New production writes belong only to PostgreSQL.

Production Gateway uses Cloudflare's `placement.region: aws:us-east-1` to run
the HTTP request chain near PlanetScale. Gateway invokes Core through a Service
Binding; placing only Core's fetch handler does not cover those RPC methods.
Keep the hint aligned with the database region. Durable Object placement remains
independent, and this setting does not change database capacity or query caching.
See [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/)
and [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

## Tools and local development

The isolated staging, production, and local/CI baseline is PostgreSQL 18. Use the current
provider-supported stable minor version; do not choose an older major merely
as a precaution without a concrete compatibility reason. The authorized cutover
uses the recorded production capacity; future capacity and availability changes
require measured demand and their own scoped review.

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

`pnpm dev:postgresql` starts the registered worktree's complete local product
with PostgreSQL 18. Its private cluster persists under that worktree's isolated
Wrangler state, so stopping and restarting preserves synthetic accounts and
product data. The Dev Supervisor owns the process; `pnpm dev:stop` stops only
this worktree's stack and database. The local Web, Auth, Gateway, Core and Remote
services use aligned worktree origins and the same runtime role. This command
never reads or writes production D1 or `~/.openmeld`.

To run that same product with a captured local synthetic D1 snapshot, use:

```sh
pnpm dev:postgresql --d1-snapshot=/absolute/private/path/snapshot.sqlite
```

The launcher imports into a separate `postgresql-d1-rehearsal/openmeld-pg-<sha256>`
cluster beneath the existing lane state. It preserves the original PostgreSQL
cluster and the lane's DO/R2 state. A transactionally stored import completion
record must match the source and actual target, with its native journal verified
as an unchanged prefix of the current canonical migration history before Workers
start. Normal trusted upgrades preserve the original completion evidence.
Restart with the same argument to retain later product writes without
reimporting. Startup can regenerate a missing external JSON projection from that
record; missing database evidence or mismatches keep startup closed without an
automatic reset or adoption of populated data. Import remains restricted to
the capture owner's local synthetic format; this command cannot export D1 or
admit a production target. See [the product rehearsal](postgresql-cutover.md#local-product-rehearsal)
for what has been verified and what remains blocked.

For an uncertain local import, `pnpm pg reconcile-d1 local <snapshot>` compares
the target's fields and identity positions in a read-only transaction. It never
reconstructs commit evidence or permits reopening. `pnpm pg read-d1-import local
<snapshot>` reads the verified database completion record used by normal startup.
Follow the [interrupted-recovery procedure](postgresql-cutover.md#local-interrupted-recovery-procedure),
including native backup/restore after PG has accepted new writes.

Use `psql` with process-injected PG variables for SQL inspection. PlanetScale's
database dashboard provides query insights, connections, metrics and backups;
Cloudflare's Hyperdrive dashboard provides connection/query metrics. No extra
MCP server or broad database-agent credential is needed for this foundation.

## Schema and migration ownership

The migration owner uses a direct TLS connection (port 5432), never Hyperdrive
or PlanetScale's transaction pooler. `pg migrate staging` verifies the exact
registered hostname and branch identity before connecting. Production uses the
separate `tooling/postgresql/cutover.mjs` entry in the
[maintenance runbook](postgresql-cutover.md#executable-maintenance-window-entries).

Migration 0033 is immutable on shared Staging. When it remains pending on an
existing database, the migration owner temporarily filters its Space-joined
Inbox inserts to existing organizations. This guard leaves historical Space and
membership snapshots unchanged and is removed after the migration transaction.
The migration SQL, checksum and journal order remain unchanged.

The current `db:generate`, `db:check` and `db:studio` commands use the native
PostgreSQL configuration. Run local migration and acceptance inside `pg:local`
with its explicit isolated connection variables. Legacy production D1 commands
fail closed. Historical D1 SQL, physical-requirement snapshots, and diagnostic
tooling remain evidence for the historical D1 revision; they cannot generate or
apply the PostgreSQL model. The first production release verified frozen capture
and native import through the existing release owner. Shared staging applies
migrations and runtime grants through `pnpm staging:deploy`. Isolated development and the foundation
probe remain validation paths; an implemented command is not production authorization.

`pnpm --filter @openmeld/db auth:generate` runs the official CLI at the installed
Better Auth 1.6 patch version after building the actual Auth config. Generation
uses a temporary file and an unreachable codegen-only connection; it needs no
database or runtime secrets. The existing bounded customization owner retains
the `openmeld` namespace, text IDs, epoch milliseconds, integer booleans and
personal Organization uniqueness. Unsupported output fails before replacing
the canonical schema. Review the resulting Git diff, then run `db:generate` and
review the migration. `auth:generate --check` checks reproducibility without
replacing the file. Neither command applies a database migration.

Drizzle Kit generates SQL and its journal in the PostgreSQL migrations directory.
The official Drizzle migrator executes that journal and owns the only PostgreSQL
history table, `drizzle.__drizzle_migrations`. Review generated SQL explicitly.
Do not replay SQLite DDL at runtime or copy D1's migration ledger. SQL files must
be transaction-compatible and must not contain their own BEGIN/COMMIT. Concurrent
index builds require a separately reviewed execution step, not a silent exception.

The thin owner acquires a PostgreSQL session advisory lock on the direct connection,
compares the complete applied hash/time prefix against the official journal, then
runs the official migrator on that same connection. Drizzle commits pending SQL
and its history together in a transaction. A second executor fails without applying
changes. A failed migration rolls back; changed or missing applied history blocks
further work. A database with the earlier isolated foundation ledger is rejected
until its adoption is explicitly reconciled. The reviewed isolated foundation
preservation sequence below performs that reconciliation. Statement and lock
timeouts bound schema operations, not active
OpenMeld execution. Do not automatically retry an ambiguous committed write.

Migration `0011` replays the bounded retired owner-awareness Inbox correction
from D1 history. It preserves item IDs, member-private state, and sent delivery
receipts, and introduces no additional schema objects. It is a local synthetic
upgrade check, not authorization to rewrite deployed data.

Review timestamp units and timezone, boolean conversion, JSON null vs SQL NULL,
collation/order, case sensitivity, parameter syntax, conflict/upsert behavior,
foreign keys, pagination, unique constraints, IDs and indexes at each business
owner. Test the real queries and transaction boundaries. Preserve public IDs,
DO identifiers, R2 keys and encrypted credential envelopes.

The product candidate's final-schema inventory, native representation decisions,
owner guards and retention boundary are recorded in
[postgresql-schema-correspondence.md](postgresql-schema-correspondence.md).

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

Request-local `pg.Pool` scopes may be reused by nested calls in the same request.
Core's database-owning RPC, queue and scheduled boundaries explicitly enter
`withPostgresRequest`, just as its HTTP boundary does. A service-binding RPC does
not pass through `fetch`; relying on the HTTP wrapper creates a new pool for each
SQL statement. Keep these scopes at the request owner, including the entire
runtime report batch, and keep transaction clients explicit.
Pure forwarding entrypoints reuse the receiving owner rather than opening
another scope. Deferred work retains its own lifetime; a finished request does
not leave a reusable pool behind. Team reads preload bindings and current
conversation proofs within that request only, preserving exact owner, runtime,
conversation and expiry checks. Inbox page counts and rows share one SQL
statement snapshot; frozen membership still governs pagination and bulk actions.
The request owner also supplies one stable database façade to its consumers.
Readiness reads can share in-flight reads by database identity without retaining
facts or failures in the next request. Separate request and protected-gate scopes
receive separate façades; no environment-wide database cache is introduced.
The pool supplies `node:net.Socket` through the driver's public `stream` option
as a limited adaptation for a reproduced normal-close error in current stable
`pg` 8.23.1 / `pg-cloudflare` 1.4.1. This combination is not Cloudflare's official
pg example. The runtime owner accepts only loopback PostgreSQL and Hyperdrive's
virtual endpoints without client TLS. It rejects remote direct connections,
TLS URL options and a non-disabled `PGSSLMODE`; it never downgrades requested TLS.
Hyperdrive owns origin TLS. Direct migration TLS remains with the tooling client.
Every explicit transaction owns one checked-out client until COMMIT or ROLLBACK;
independent sibling operations must never borrow that transaction's client.
Background work after a request closes creates and closes its own scope.

Durable Object input gates (`blockConcurrencyWhile`) also block completion
events for sockets initiated before the gate. Any protected operation that
uses PostgreSQL must create and close its pool inside that same gate, with
`withPostgresRequest(..., { reuseConnection: false })`. Space's private
`blockConcurrencyWithPostgres` owner applies this rule to its existing
initialization, publication, thread, ownership and deletion boundaries.
Pure local SQLite reconciliation keeps its ordinary input gate. Preserve these
idempotency and ordering boundaries; do not expand a gate to an entire network
request or move a protected write outside it to avoid connection deadlock.

Space also admits each explicit PostgreSQL transaction through its native input
gate before checking out a client or sending BEGIN. Its request-scope transaction
runner covers alarm projections and RPC/HTTP work alike. Protected scopes retain
that owner, while a Space-local context identifies their active gate.
Transactions within an already active gate use its current protected pool
without opening another gate; nested SQL transactions remain unsupported.
Deferred work which outlives a scope keeps its matching-binding owner and seeks
fresh admission once the original gate has finished. COMMIT or ROLLBACK and pool
closure finish before the gate opens. A transaction started outside the gate
could otherwise retain a
scarce Hyperdrive origin slot while a later gate blocks the socket completion
needed to release it and waits for that same slot.

Only the database transaction is protected this way; ordinary queries do not
acquire a transaction gate, and the rest of an alarm or request is not held
inside it. A failure in a newly protected
transaction is captured inside the gate, including cleanup, and rethrown to its
existing caller after the gate settles. It must not reset the Space merely
because an ordinary background transaction rolled back. Existing protected
publication and ownership operations retain their failure semantics.

Space transactions have a 15-second budget starting before client acquisition.
The existing 10-second acquisition cap remains within this budget. BEGIN sets
PostgreSQL 18's transaction-local `transaction_timeout` to the remaining budget
in the same protocol message, bounding SQL, lock waits and idle transaction time
without relying only on a Worker timer. A local watchdog allows one additional
second for the origin to finish, then destroys the checked-out client through
the driver's public release API. Client disposal has a two-second cap, leaving
margin below the native gate's 30-second reset limit. The watchdog covers the
callback, COMMIT and ROLLBACK; it does not merely abandon a live client.
When PostgreSQL ends a session with a fatal timeout, the owner waits for the
native close before releasing it, preserving the original SQLSTATE instead of
sending ROLLBACK or Terminate into a closing socket. Expired clients are not
reused, and late callbacks cannot submit more SQL or commit. Ambiguous commit
failures are not replayed; existing domain idempotency and outboxes own recovery.

This serializes a Space only for each admitted SQL transaction, not for a whole
alarm, HTTP/RPC request or external service call. Space transaction callbacks
must keep non-database work outside the transaction. Assess throughput using
the native concurrent publication/projection regression and the affected Space
API suite; local results do not establish production requests-per-second.

Keep the operator/default provider role for provisioning only. Create a distinct
migration owner and a runtime role per environment. Runtime roles must have no
administrative attributes or broad inherited roles; grant only USAGE plus
SELECT/INSERT/UPDATE/DELETE on explicitly owned schemas/tables and required
sequence access. The migration ledger and `openmeld_migration` tool-metadata
schemas are inaccessible to runtime; neither belongs in application grants.
Default privileges belong to the actual object-creating role. Verify grants
again when changing migration ownership or restoring with a different owner.

Staging acceptance uses a separate synthetic `openmeld_probe.records` table.
It is not a business table and must never be provisioned in production. No
production data is copied to it. The probe requires a secret bearer token,
an exact environment marker and a finite expiry. It accepts only POST
`/acceptance`, `/runtime-transport`, `/business-write` and `/business-read`, with
no caller-supplied SQL or business identities. The transport check uses the
actual shared product connection owner and the synthetic probe table to verify
commit, rollback, query errors and pool closure. Business checks use the actual
Auth Drizzle Profile repository and Core Project service against fixed synthetic
users and Organizations. They verify writes, reads in later requests, owner and
tenant isolation, member permission denial and pool closure. This is cloud
business-owner evidence, not cloud Auth sign-in or a complete deployed cloud UI.
Remove the probe after cloud acceptance; retain the synthetic database and
historical foundation evidence for inspection.

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
node tooling/postgresql/probe.mjs transport-check <returned-workers.dev-url>
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

### Existing foundation business-owner rehearsal

The existing isolated `openmeld-postgresql-stg` database and branch are
`jacdfxhph47k` / `aol2e3kwz867`, in Amplift and Cloudflare account
`e74a33891b4c7a16b1fe853c41011f52`. Reuse Hyperdrive
`6af2d43ec8d8498b9607c653ca231e73`, migration role
`pscale_api_m7rr7fm14at8` and runtime role `pscale_api_0hf13zdprg79`.
Shared product staging now reuses this foundation. No new database,
branch, role, Hyperdrive, KV, R2, Queue or container is needed.

On 2026-10-04, read-only inspection found the original one-row
`openmeld_meta.migrations` ledger, an empty `openmeld` schema and an empty
`openmeld_probe.records` table. A direct TLS `pg_dump` preserved those three
schemas in a 5,212-byte archive with SHA-256
`0cc159e3e9014271b4888d5fdf2f86abfc2d6ed97336162f06ccdcfec2a99d9a`.
Use PostgreSQL 18 tools with `sslmode=verify-full` and trusted roots; libpq on
this workstation requires `sslrootcert=system`. The archive was restored into
a fresh local cluster before validating the preservation operation. Local
restore used `--no-owner --no-acl`; it proves content retention, not cloud grants.

`preserve-foundation.sql` checks the exact role, database, schema ownership,
empty application schema, absent new/archive namespaces and exact original
ledger row, including its microsecond timestamp. One transaction renames the
two old namespaces to `openmeld_foundation_20261002` and
`openmeld_foundation_meta_20261002`. It deletes no data and does not pretend the
old journal is a Drizzle journal. The existing migrator then creates the current
schema normally. Local validation retained both schema OIDs and the original
ledger row, then applied all 14 native migrations and found 159 application
tables. Reinspect cloud facts and retain the archive before execution; unexpected
objects or an already-preserved target require inspection, not reset.

Run only this existing-foundation sequence after the scoped technical review:

```sh
node tooling/postgresql/cloud.mjs preserve-foundation staging
node tooling/postgresql/cloud.mjs migrate staging
node tooling/postgresql/cloud.mjs grant-runtime staging
node tooling/postgresql/cloud.mjs seed-business staging
node tooling/postgresql/cloud.mjs accept staging
node tooling/postgresql/probe.mjs deploy
node tooling/postgresql/probe.mjs check <returned-workers.dev-url>
node tooling/postgresql/probe.mjs transport-check <returned-workers.dev-url>
node tooling/postgresql/probe.mjs business-check <returned-workers.dev-url>
node tooling/postgresql/probe.mjs cleanup
```

Do not rerun `prepare` or `hyperdrive` for this sequence. `seed-business` refuses
any populated application table, then atomically inserts two synthetic users,
two Organizations and two memberships. The probe creates one Profile and one
Project through their real owners. Fixed identities live in
`tooling/postgresql/business-fixture.mjs`; no credentials or sessions are seeded.
Keep these records after the check. Cleanup removes only the isolated probe
Worker, including after a failed check, and records whether checks succeeded.
The deployed bundle and config are hashed together, covering imported business
owners. Verify the actual runtime role's permissions after schema creation;
local ACL-free restore is not permission evidence. The configured token window
expires at `2026-10-04T06:00:00Z`; renew it explicitly before a later run.

The reviewed sequence completed against that exact target on 2026-10-04 using
candidate `c6e8f70270ab5046a3c620fb572ab906cfd1f63c`. The deployed Worker version
was `e26c0da0-3ce9-4270-afb4-f5e31620a1d0`; the emitted bundle and config SHA-256
was `08bf437bee0ee0fc939a84a4b990de62afe42cb9d36c29c2152524330fd33800`.
Each check passed separately:

| Check | Observed result |
| --- | --- |
| Direct runtime role | Commit, rollback, CRUD, immediate reads and denied schema changes passed. |
| Worker / Hyperdrive connection | Unauthenticated requests returned 401; repeated transactions, CRUD, rollback and denied DDL, ledger reads and TRUNCATE passed. |
| Product PostgreSQL connection owner | Repeated request pools, commit/rollback, immediate reads, query-error propagation and normal close passed. |
| Auth Profile / Core Project owners | Repeated writes and later-request reads passed; wrong owner/tenant and member writes were rejected, with request pools closed. |

Wrangler confirmed probe deletion at `2026-10-04T04:06:59.043Z`, before expiry.
Final read-only inspection at `2026-10-04T04:07:53.525Z` matched all 14 native
journal hashes and 159 application tables. Only five application tables contained
data: two users, two Organizations, two memberships, one Profile and one Project.
The exact Unicode/literal-escape marker and owner/Organization identities matched.
The probe table was empty. The original foundation ledger, including timestamp
`2026-10-02 17:26:58.727893+00`, remained intact. The runtime retained business
DML privileges but could not use the old ledger, native journal or import-metadata
schemas. The initial read-only evidence script assumed unordered SQL results had
a stable order; sorting the returned table counts corrected that comparison,
without repeating mutations or changing database state.

The machine-readable deployment/check/cleanup receipt is in
`tooling/postgresql/resources.json`. This closes the isolated business-owner
Hyperdrive acceptance row. It does not certify cloud Auth login, a complete cloud
product deployment, a legacy writer shutdown or production cutover.

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

## Candidate contract impact

The persistence boundary changes from shared D1 bindings to one
`OPENMELD_POSTGRESQL` Hyperdrive binding across Auth and Core. Gateway and Remote
continue through their existing service/RPC owners. IDs, tenant and Profile
authorization, public HTTP/RPC/WebSocket envelopes, encrypted credentials,
CLI/Service setup and Wake payloads, and published reply references retain their
existing contracts. Diagnostic binding names identify PostgreSQL; the retained
nullable `d1LocalDbPath` field is null for this runtime. It is compatibility
metadata, not an alternate D1 read path.

Old cloud code can continue talking to the unchanged local CLI/Service protocol,
and the candidate cloud can use the current local protocol. A database binding
switch alone cannot make the mixed D1/PostgreSQL cloud revision window safe:
each shared relational writer must switch together after the reviewed freeze,
import, reconciliation and guarded component promotion. This candidate provides
no dual reads or writes and does not claim a safe rolling product cutover.
No local component contract bump is required by the persistence-only boundary;
release artifact eligibility still follows the base-aware local-component gate.

The fixed-main Plugin/evidence additions retain their upstream optional
capability contracts and rollout order in
[Shared Agent Plugins](../architecture/shared-contracts.md#shared-agent-plugins).
The PostgreSQL port adds no wire field or required local-component floor to
those contracts. Native migration `0015_plugin_action_requests` supplies the
storage corresponding to D1 `0192` before the new Core producer runs. Gateway
and schema readers must understand the new Inbox target and replay reasons
before Core emits them; Web/CLI consumers follow the coordinated cloud release.
Feature-branch verification remains deferred. Final CLI/Service artifacts are
stamped and published from the separately authorized release lane.

The remote capture and import entry extends only the shared migration-tool
evidence schema with the registered D1 source and PlanetScale target identity.
Existing local completion records retain their shape. Operators must use the
same reviewed candidate for capture, import and release admission; this is not
a new CLI, Service, Agent or public API payload. Core and CLI publication now
check the native journal and runtime grants instead of the D1 pending list.
The initial deployment retains paused Cron until an explicit accepted-source
restore command succeeds; the ordinary release path refuses paused schedules.

RuntimeCoordinator keeps in-flight execution authority. The PostgreSQL dispatch
and task ledgers remain durable evidence and projections. The submission claim
is a bounded duplicate-submission mutex: exact delivery key, expiring claim nonce,
and release by that nonce only. Expiry allows a new claim; an old executor cannot
clear its replacement. An ambiguous submission retries the same durable request
and idempotency key. This mutex neither decides an execution outcome nor
authorizes a Space reply.

Scoped architecture acceptance: the candidate preserves the data ownership,
shared contracts, RuntimeCoordinator, local Service trust, and Space publication
rules. Private static class operations keep complex entrypoint bodies inside the
same owner while the original public entrypoint holds the request connection;
they do not add RPC methods. See
[Cloudflare RPC visibility](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/).

## D1 residual inventory

- `packages/db/drizzle/**`, older SQL journals, and
  `packages/db/d1-history/physical-requirements.json` preserve immutable deployed
  history and frozen physical diagnostics. They are not a current schema model.
- D1 tooling and its captured fixtures preserve the deployed revision's
  operational vocabulary. Current `db:*` commands use PostgreSQL or fail closed;
  the candidate does not authorize historical production operations.
- Production and staging Auth/Core configurations and generated types declare
  the native Hyperdrive binding and no D1 aliases. Each environment has its own
  PostgreSQL database as its sole relational authority. Retained D1 databases
  are historical sources, not runtime fallbacks.
- Space, RuntimeTransportHub, and other Durable Objects retain private SQLite
  storage for their own state. OpenMeld Service's isolated local storage and R2
  file ownership also retain their existing boundaries.
- Shared product Auth/Core/Gateway/Remote runtime code has no D1 driver,
  `D1Database`, or legacy shared binding reads. The native runtime gate checks
  these owners; native fixture harnesses execute the complete PostgreSQL journal.

## CI validation

The path-filtered `.github/workflows/postgresql-foundation.yml` installs PG18
from the official PostgreSQL apt repository and runs the same isolated checks.
It never receives Doppler, PlanetScale, or Cloudflare credentials.

Build the acceptance package's dependency graph before its standalone typecheck:
`pnpm exec turbo run build --filter=@openmeld/postgresql^...`. Its real business
acceptance imports Auth/Profile and Core/Project owners, whose package exports
require the Auth and Projects build outputs as well as the native database.
`tooling/postgresql/package.json` declares those dependencies so a clean runner
does not rely on artifacts left by unrelated local builds.

Run the same `pnpm pg:check` locally and in CI with ephemeral PostgreSQL 18.
It exercises baseline, repeated application, upgrade with preserved data,
checksum drift, concurrency, rollback, runtime permission denial, database
isolation and actual pg_dump/pg_restore. CI has no provider or production
credentials. Hosted success can be claimed only after the workflow actually runs.

### Core Worker coverage and the unresolved shared-process stall

The ordinary `pnpm --filter @openmeld/core test:integration` command remains the
standard eight-shard entrypoint. On the PostgreSQL candidate integrated with
main `6981ec654fa9c2454bdad6d370eabde738a648e7`, its ordinary
`test:integration:shard-2` process stalled on 2026-10-03: one attempt completed
25 of 28 files before interruption (exit 130), and a later unchanged-source
attempt completed 15 of 28 before interruption (exit 1). Neither is a pass.
Reproduce with the normal shard command; preserve its complete output and
termination result rather than treating a partial test summary as completion.

The installed Worker pool is 0.12.14 with Vitest, runner and snapshot 3.2.4.
The later log contains cross-file Inbox retry work and Durable Object
invalidation reporting `index.ts changed`. The pool emits that message when an
old object's constructor differs from the newly imported constructor; it does
not establish that a source file changed on disk. Module reload and surviving
background objects are concrete leads, but the stall's root cause is unresolved.
This is not evidence of a PostgreSQL connection leak or a confirmed upstream
bug. The comparable upstream report
[workers-sdk#15498](https://github.com/cloudflare/workers-sdk/issues/15498) is
a lead, not a diagnosis. Do not suppress errors, increase behavior timeouts,
or add a private Worker runner to make this command appear successful.

For bounded coverage, every file discovered from the actual Core configuration
can run in a separate ordinary Vitest process and fresh PostgreSQL 18 cluster.
The candidate's complete discovered scope was 219 files; all 219 independently
returned exit 0. That proves the individual files' behavior, not successful
completion of the ordinary long-lived shard process. The following reproducible
commands discover the current scope instead of maintaining a second file list.
Run them from the repository root after installing the pinned dependencies:

```sh
mkdir -p dev-tmp
pnpm pg:local run node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const root = resolve('services/core');
const require = createRequire(resolve(root, 'package.json'));
const { createVitest } = await import(pathToFileURL(require.resolve('vitest/node')).href);
const runner = await createVitest('test', {
  root, config: resolve(root, 'vitest.config.ts'), watch: false,
});
try {
  const specifications = await runner.globTestSpecifications();
  const files = specifications.map(spec => relative(root, spec.moduleId)).sort();
  if (!files.length || new Set(files).size !== files.length) {
    throw new Error('Empty or duplicated Core Worker scope');
  }
  writeFileSync('dev-tmp/core-worker-files.json', JSON.stringify(files, null, 2));
  console.log(`Discovered ${files.length} Core Worker files`);
} finally {
  await runner.close();
}
NODE

# Run only after discovery exits successfully. No cached success or retries.
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = JSON.parse(readFileSync('dev-tmp/core-worker-files.json', 'utf8'));
for (const file of files) {
  console.log(`Core Worker file: ${file}`);
  const result = spawnSync('pnpm', [
    'pg:local', 'run', 'pnpm', '--filter', '@openmeld/core', 'exec',
    'vitest', 'run', '--config', 'vitest.config.ts', file,
  ], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  console.log(JSON.stringify({ file, exitCode: result.status, signal: result.signal }));
  if (result.status !== 0) process.exit(result.status ?? 1);
}
NODE
```

Both snippets use public Vitest APIs or the ordinary Vitest CLI. Each child
inherits its full output; the loop stops at the first unsuccessful exit or
signal. Record the discovered manifest, candidate identity, commands and exit
results with the review evidence. Do not call this a passing `test:integration`
run, Ready status, or production readiness. Real Web → Service → Wake → trace →
restart and continued product reads/writes remain separate acceptance gates;
a similar stall in the actual product blocks local-product acceptance.

Staging order: provision isolated targets and least-privilege roles; apply
reviewed migrations once; verify grants and backups; deploy only the isolated
probe; run authenticated and unauthorized checks; record evidence and remove
the probe. Future product staging adaptation uses the existing guarded release
entrypoint after its owners explicitly support the new database contract.

Production uses the existing scoped release control plane and database lease
in [production-release.md](production-release.md#production-database-release).
The cutover is complete; routine releases apply native migrations through that
owner rather than repeat D1 capture/import. Preserve source and target identity,
immutable migration history, target-bound credentials, one migration executor
and mixed-version compatibility. New cutovers require separate authorization.

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

## Pre-cutover preparation status

The following records preserve historical rehearsal scope and revisions. They
are not the current production boundary. The completed maintenance window is
recorded in [the cutover owner](postgresql-cutover.md#current-production-state).

The local product milestone at fixed main baseline
`6981ec654fa9c2454bdad6d370eabde738a648e7` has passed native journal 0012
acceptance: ordinary owner/member Web sign-in, organization permission denial,
Agent rename, public CLI Project creation/update, and two actual Web → Service →
Codex → Space replies separated by a normal complete stack stop/restart.
The same login session and synthetic product records survived that restart.
Each trace linked its reply to a `reply_published` coordinator execution. The
post-terminal head lifecycle read was missing; these receipts do not prove
in-flight head reads. The ordinary long-lived Worker pool limitation above
remains unresolved. This is Draft local-product evidence, not production
readiness or a successful ordinary full-suite run.

Preparation continued locally before a separately coordinated maintenance
window for a small internal test group. The fixed integration candidate and
short manual sequence live in the cutover owner above. Longer downtime, normal
Stop and signing in again are acceptable; data, permissions and one relational
authority remain required. A general maintenance orchestrator or automatic
drain certificate is not required. A PostgreSQL-to-PostgreSQL restore does not
cover D1 data migration.
The local D1 capture/COPY rehearsal now preserves and reconciles representative
business records and verifies rollback, including sequence generators. It also
verifies an actual frozen D1 source and archives its exact maintenance metadata
without importing that metadata as application data. Migrated
Web sign-in, retained database-backed sessions, permissions, actual DO/R2 file
contents, normal product writes and complete restart persistence now pass
locally. An independent sample produced by the real legacy D1 Auth owner also
passes migrated password login, session resolution and permission checks.
The 2026-10-04 frozen-source product rehearsal also passed one actual migrated
Codex execution and visible Space reply with coordinator `reply_published`.
This closes the earlier quota-blocked acceptance row without changing quota,
permissions, model or Profile. A normal stop/start and one startup retry retained
the original Chrome login, visible reply, Project write, Inbox read state and
identical import receipt. A transient Web startup stall and one recovered Inbox
projection warning are recorded in the cutover owner; neither is claimed fixed.
In-flight head reads, task mutations and external integrations are not proved by
this sample. The existing release path implements snapshot admission and native
bindings. Live maintenance actions and production acceptance were subsequently
completed in the authorized window recorded above.

At the time of these preparation receipts, production Spaces remained on D1.
Those receipts did not authorize production mutation; the later cutover had
separate explicit maintenance-window authorization. Shared-staging mutation and
additional paid resources remain outside that delivery. Preserve the
before/after-first-PostgreSQL-write recovery boundary below.

## Controlled maintenance-window cutover

The title does not promise a duration. Follow the current
[manual cutover sequence](postgresql-cutover.md#remaining-release-and-maintenance-acceptance)
and measure a representative rehearsal. This small internal deployment accepts
a longer night-time window; the following points retain the data-safety boundary.

1. Adapt from current merged source; inventory every reader/writer, scheduled
   job, queue consumer, Auth/Core/Remote/Gateway dependency and retention task.
   Rehearse schema conversion and business flows with synthetic isolated data.
   Keep original D1 exports/history recoverable; define acceptable historical
   omissions explicitly. Freshness `expires_at` is not a retention cutoff.
2. Prove restores, least-privilege grants, tenant authorization, IDs, DO/R2
   references, encryption compatibility and final schema/query plans. Record
   exact source, bindings, backup IDs and the agreed maintenance window.
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
