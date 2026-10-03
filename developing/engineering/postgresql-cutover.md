# PostgreSQL Cutover Preparation

## Agent Context

- Purpose: Track the executable data-migration and writer-freeze preparation before a coordinated D1 cutover.
- Read this when: Preparing a migration rehearsal, inventorying writers, or reviewing maintenance and recovery evidence.
- Update this when: Capture/import contracts, writer coverage, rehearsal evidence or the guarded release plan change.
- Do not use this for: Authorization to export production data, deploy, freeze active Spaces or switch database bindings.
- Source of truth: Native and historical journals own storage; RuntimeCoordinator owns workstation execution; the existing production release owner owns deployment and leases.

## Current boundary

The local PostgreSQL product milestone is commit
`6f3f178e28accaec7f00dcfa8abba8a9677abeb0` in Draft PR 1460. Its real product
evidence and unresolved Worker-pool limitation are in
[the PostgreSQL workflow](postgresql.md#pre-cutover-preparation-status).
Current work prepares a later maintenance window while production Spaces keep
running on D1. There is no production data export, writer freeze, product
deployment or database cutover authorization here.

The reproducible database rehearsal captures all 159 historical tables from
actual local D1. Its 287 records populate 18 tables: accounts, sessions, users,
Organization membership, Profiles, both owner-account and hosted Center Agent
Bindings, Projects, Space references, documents/folders, Inbox state and
pagination, Agent Activity, and an opaque credential envelope. Empty tables are
included explicitly. COPY and full-field reconciliation preserve the values;
Better Auth verifies the migrated password hash. This database assertion is
not a real Web login or a claim that external credentials remain usable.

The rehearsal passes unknown-table, unsupported stored-type, invalid UTF-8,
NUL-text, unsafe-integer, native-constraint, value-mismatch and process-kill
cases. Failed imports leave every application table empty; a late identity
failure also rolls back an earlier sequence restart. Killing the importer
during real COPY leaves a clean target that accepts a complete retry.

Run from the repository root with PostgreSQL 18 installed:

```bash
pnpm --filter @openmeld/postgresql test:d1-migration
```

The command owns temporary D1 and PG state, never production state. To retain
private synthetic evidence, set `OPENMELD_D1_REHEARSAL_OUTPUT` to an absolute
directory-name prefix under an existing private directory; it creates a new
directory and writes a receipt only after every case passes. A 2026-10-03 local
run took about 28 seconds including fixture preparation and failure cases, but
excluding the outer PG cluster startup. This is not a production throughput
measurement or maintenance-window estimate. Migrated real Web login,
permissions, retained DO/R2 references, Wake, complete writer freeze/drain and
cloud recovery acceptance remain open.

## Tool selection and exact-value contract

Checked on 2026-10-03 with installed Wrangler 4.145.0, pgloader 3.6.10 and
PostgreSQL 18. The pgloader probe used `data only`, `include no drop`, quoted
identifiers, no index/sequence rebuild and stop-on-error. It nevertheless
attempted native foreign-key removal, failed on a mixed-case table reference,
returned exit 0 and imported no row. This configuration/version is unsuitable
for the existing OpenMeld target; this does not claim pgloader cannot migrate
other databases. Version 4 remains a development build.

The official local D1 SQL export round trip changed a value containing both a
literal backslash-n and a real newline. It also omitted the implicit Inbox
rowid: 71 became 1. No production export was attempted, so this is not evidence
of the remote export implementation. The official export documentation also
warns about numeric precision and says an export blocks other requests.

Use the official D1 read-query contract to capture a stable source, SQLite's
native engine to read the immutable historical schema and snapshot, and
PostgreSQL's native COPY through `pg-copy-streams` 7.0.0. The OpenMeld adapter
owns only its current table/type/identity mappings and reconciliation. It does
not parse SQL, recreate PostgreSQL constraints, skip rejected rows, introduce
CDC or keep two relational writers.

- Enumerate every source table and column; unknown or missing application
  tables/columns fail. Preserve D1 migration history as archive metadata, not
  as PostgreSQL's Drizzle ledger. `_cf_*` belongs to D1 storage; private DO
  SQLite and R2 bodies remain with their existing owners.
- Inspect actual SQLite `typeof` values. Read integer cells as decimal text
  and text cells as UTF-8 hex to avoid JSON-number rounding and SQL-string
  escaping. Keep NULL, empty text, quotes, literal escapes, newline, Unicode
  and encrypted envelope bytes distinct. Reject unsupported stored types,
  invalid UTF-8, PostgreSQL-inexpressible NUL text and integers outside the
  product's safe runtime range instead of silently converting or dropping them.
- Preserve Inbox `rowid` as native `sequence`, including gaps and persisted
  `through_row_id`. Set its next sequence above both retained items and all
  persisted page cutoffs: the fixture retains items 71/73/79 and cutoff 900
  after a deleted tail, so the next item is 901. Preserve explicit identity values and historical
  `sqlite_sequence` high-water marks. Advance native generators with
  transactional `ALTER SEQUENCE ... RESTART`; do not treat `setval` as
  rollback-safe. Native-only submission mutex fields begin NULL and do not
  acquire execution authority.
- Capture generated source cells and compare them with the archival engine's
  result, then compare every native target field. Bind the receipt to exact
  source schema SQL, immutable historical migration hashes and snapshot bytes.
  Order tables by declared foreign keys plus the explicit Binding-to-Profile
  trigger dependency. That trigger checks Profile ownership immediately;
  deferring foreign keys alone cannot make unordered Binding inserts valid.
- Keep COPY, deterministic full-field comparison by primary/non-null unique
  key, generator advancement and commit on one direct connection. Keep native
  constraints and owner triggers enabled. Import only into an empty registered
  isolated target. A failed import does not certify the target or permit resume
  from guessed progress.
- Capture and import are currently restricted to local synthetic targets.
  Multiple paginated reads do not create a global consistent snapshot. A real
  final capture requires every writer frozen and source consistency proved;
  equal counts alone cannot establish this. Snapshots contain Auth material:
  restrict file permissions and omit values and credentials from logs.

## Writer and retained-state inventory

The current table inventory is derived from the immutable D1 history and
included in each capture receipt, including zero-row tables. It is compared
with the native journal's target inventory. The number 159 is this baseline,
not an allowlist that permits later tables to disappear.

| Owner/entry | What can still change during an apparent quiet period | Required maintenance handling |
| --- | --- | --- |
| Auth HTTP and `AuthRpcEntrypoint` | Sessions, credentials, users, membership, Profiles, preferences and deletion intents; authenticated reads may refresh session state | Stop new user mutations and session-writing traffic; include service RPC and direct Auth routes, not only Web |
| Auth 15-minute scheduled entry | Space membership overlay repair and Profile deletion outbox, including Core callbacks | Suspend the schedule and settle already-started convergence work before final capture |
| Core HTTP/RPC and Gateway producers | Product mutations, activity, Inbox, Projects, files metadata, service lifecycle reports and external webhooks | Gate all ingress producers; reject/retry explicitly without acknowledging unpersisted work |
| Core Queue router | Hosted recovery, Agent creation, Slack/Message Channel and GitHub events | Stop producers first, then pause or settle consumers with retained receipts; queue UI quietness is not proof |
| Core minute/daily/weekly scheduled tasks | Routine starts, continuation/publication retries, Inbox emails, channel work, projections, retention, digests and reports | Prevent new scheduled work and settle accepted work; retention is a writer too |
| `RoutineRunWorkflow` | Durable submission, callback waits, finalization and continuation steps | Inventory actual workflow instances and their callbacks; a removed cron does not stop existing workflows |
| Space DO fetch/WebSocket/alarm | Canonical messages, dispatch conveyor, projection outboxes, file/task delivery, native stop and execution-input retries | Keep DO data and IDs; gate new admission, drain or explicitly retain every outbox and associated relational writer before switching |
| RuntimeTransportHub/RuntimeCoordinator RPC/WebSocket/alarm | Running workstation executions, leases, lifecycle, tokens, accepted/waiting heads, finalization retries and publication | Use the authoritative in-flight contract and retained indexes; let accepted work converge safely or use the normal explicit stop path |
| PrepareSessionHub | Service preparation and reporting over sockets | Include existing sockets and callbacks in the freeze, not only fresh connections |
| LarkChannelConnector DO | Provider connection activity and alarm-driven continuation | Suspend new channel ingress and settle already-accepted deliveries |
| Remote/Center Agent durable runtime | Active inference/tool execution, Core callbacks, native publications, auxiliary usage settlement and computer work | Block new submissions and resolve actual durable executions/callbacks; Core database quietness alone is insufficient |
| OrganizationFileRoot and Space file owners | SQLite file/upload state and R2 upload/cleanup effects linked to relational metadata | Preserve IDs/object keys and settle writes/cleanup; a PostgreSQL restore cannot undo DO/R2 effects |
| Operator/release/database tools | Manual SQL, migrations and administrative repair | One reviewed maintenance owner and existing release lease; no competing writer or bypass deploy path |

Relevant source owners: `services/auth/src/index.ts`,
`services/auth/src/lib/rpc/entrypoint.ts`, `services/core/src/index.ts`,
`services/core/src/shared/queue/core-queue-router.ts`,
`services/core/src/scheduled/core-scheduled-tasks.ts`,
`services/core/src/routines/routine-run-workflow.ts`,
`services/core/src/space/transport/do/space.ts`,
`services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts`,
`services/core/src/prepare-session/transport/do/prepare-session-hub.ts`,
`services/core/src/remote-agent/transport/lark/lark-channel-connector.ts`,
`services/remote-agent/flue-adapter/cloudflare-entrypoint.ts`, and
`services/core/src/files/organization-file-root.ts`.

This is a source inventory, not a completed freeze implementation or evidence
that production has drained. In particular, a historical `reply_published`
projection plus a missing terminal head is not proof that no execution remains.
The maintenance rehearsal must hold a real task in flight, prove new admission
is closed, then prove safe authoritative convergence and publication. It must
also cover queued/outbox work and recovery after an interrupted maintenance.

## Remaining release and maintenance acceptance

Extend the existing guarded release owner with a PG target plan/dry-run; keep
actual promotion closed until source identity, complete writer freeze/drain,
final export/import/reconciliation, permissions, cloud product acceptance and
recovery evidence all exist. Do not add a parallel deploy command.

Before PostgreSQL accepts new product writes, coordinated rollback may restore
all source/bindings to the unchanged frozen D1 authority. After new PG writes,
rollback requires a fresh freeze and preservation/reconciliation of those
writes, including DO/R2 side effects, or a forward fix. Pointing back to the old
D1 snapshot would lose data. No maintenance duration is promised before a
representative complete rehearsal is timed.

## Official references

- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [pgloader SQLite options](https://pgloader.readthedocs.io/en/latest/ref/sqlite.html)
- [PostgreSQL 18 COPY](https://www.postgresql.org/docs/18/sql-copy.html)
- [pg-copy-streams](https://github.com/brianc/node-pg-copy-streams)
