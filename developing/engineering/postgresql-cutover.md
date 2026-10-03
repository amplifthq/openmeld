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
measurement or maintenance-window estimate. The separate product checks below
cover Web/Auth, permissions and retained DO/R2 content. Migrated Wake, complete
writer freeze/drain and cloud product recovery acceptance remain open.

## Local product rehearsal

The 2026-10-03 full-product rehearsal used two deliberately separate sources:

1. Existing synthetic native-PG product state was materialized into the immutable
   historical D1 schema, inserted through actual local D1, captured and imported
   into a fresh PG cluster. This source contained 425 rows in 42 populated tables
   out of 159. It proves D1 transport and retained-product compatibility; it does
   not establish the old D1 runtime's producer format.
2. An independent empty historical D1 fixture used the unmodified Auth config,
   Drizzle D1 schema and owner implementation from baseline
   `6981ec654fa9c2454bdad6d370eabde738a648e7`, with Better Auth 1.6.30.
   Real signup, synthetic email verification, password sign-in and Organization
   APIs created two accounts, sessions, personal Organizations, one shared
   Organization and owner/member roles. The fixture captured verification email
   locally and sent nothing externally. It did not reverse-seed PG rows or
   recreate the whole legacy product.

The full product used the first snapshot's hash-isolated database while the
original PG cluster remained stopped and preserved. Normal CLI Project rename
was observed in that target's actual `data_directory`, with a different value
in the source snapshot. Both pre-migration browser sessions resolved through
`/v1/account/session`; that Auth owner explicitly disables cookie caching, and
the returned session/user IDs matched source D1 records. Normal Web sign-in also
succeeded after migration and a complete stack stop/restart. The changed Project
name and Inbox read state survived restart without reimporting.

The same lane retained actual Space messages, file-owner SQLite state and R2
bodies. A file uploaded normally before migration, then copied to the existing
Space, retained its IDs and revision. The Web file viewer's 280 UTF-8 bytes
matched the original exactly, including Unicode and literal escapes. A second
account was denied the private Organization. A synthetic encrypted token passed
the actual product repository/AES-GCM reader after migration; wrong tenant and
wrong key were rejected. No external credential was exercised.

The second snapshot ran in its own fresh hash-isolated PG cluster. Both cookies
issued by the real legacy Auth producer resolved to the original sessions through
the current public Auth HTTP endpoint with cookie caching disabled. These are
API-boundary checks. Separately, both legacy passwords succeeded through normal
Web sign-in into the retained shared Organization. The current server permission
endpoint allowed channel connection for the owner and denied it for the member.

The migrated Codex Wake attempt was rejected before execution with
`usage_exhausted`, while Binding, Runtime and Service evidence was ready and the
route was online. An independent current account-limit read confirmed 100% use
of the ordinary Codex weekly window and `creditsAvailable: true`. OpenMeld's
current usage admission rejects this Codex Wake; this does not establish that
paid capacity is unavailable. The lane had no other existing workstation Agent
Profile. The quota was not bypassed; previous native-PG Wake successes do not
stand in for migrated Wake or authoritative in-flight drain evidence. Keep those
acceptance gates open until an actual admitted execution can be observed.

The new launcher option reuses the existing import owner and local database
lifecycle. It does not transfer execution authority from RuntimeCoordinator,
file-body ownership from R2, or Space state/outbox ownership from Durable Objects.
Production/shared-staging admission remains closed.

## Local interrupted-recovery procedure

Keep product processes stopped while inspecting a target whose import outcome
or receipt is uncertain. In the existing isolated database environment, run:

```sh
pnpm pg reconcile-d1 local /absolute/private/path/snapshot.sqlite
```

This uses the import owner's exact schema, journal, table/field and identity
mapping in a repeatable-read, read-only PostgreSQL transaction. It compares all
application rows and the unconsumed identity positions with the source snapshot;
it does not COPY, reset a sequence, repair a row or regenerate a commit receipt.
The result is `snapshot_reconciled`, explicitly `inspectionOnly: true` and
`promotionAllowed: false`. Equality does not prove that no business write ever
occurred or that DO/R2 effects are unchanged. A concurrent writer would also make
this only a point-in-time observation, never a writer-freeze certificate.

Use the existing development lifecycle and the following recovery boundaries:

1. Before capture completes, a rejected source leaves no successful snapshot or
   manifest. Preserve the source, resolve its actual rejection and capture to a
   new private path; partial artifacts are not import evidence.
2. If import did not commit, PostgreSQL rolls back all rows and transactional
   identity restarts. Inspect the empty target before retrying the same verified
   snapshot. The real COPY interruption case exercises this boundary.
3. If import committed but its external receipt is missing, startup stays closed
   and refuses to import over the populated target. Read-only reconciliation can
   inspect equality, but its result cannot replace a commit receipt. The local
   rehearsal restores the preserved original receipt and then restarts with the
   same snapshot; it never fabricates one from matching counts or hashes. Without
   the original evidence, retain the target for diagnosis rather than resetting
   it or opening the product.
4. Once PG contains new writes, preserve that PG state. The rehearsal advances a
   real identity and changes a row; reconciliation rejects both against the old
   snapshot. Native `pg_dump`/`pg_restore` restores the resulting full database
   into a separate empty database, then compares all 159 tables, identity states
   and migration history. Reapply and verify runtime grants. Restarting the
   original development database retains the new writes and original receipt.

The repeatable `test:d1-migration` entrypoint includes these real storage and
development-lifecycle checks. It does not start product traffic, restore DO/R2,
exercise a workstation execution or certify a complete maintenance operation.
Retain the actual DO/file IDs, object keys, revisions, bodies and outbox effects;
restoring PostgreSQL does not restore those owners. Cloud/provider recovery and
the final D1-compatible maintenance barrier remain separate acceptance gates.

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

The existing `release:plan -- --database-cutover --base <fixed-baseline> --json`
entrypoint now produces a read-only PG preparation plan. It reuses the existing
source-impact and rolling-order owners and the native migration journal reader.
The plan contains registered target identity and hashes, not live cloud evidence.
All executable step arrays are empty, promotion is false, and evidence remains
`not_evaluated`. Deploy, preflight and verify do not accept this option. The
ordinary source plan excludes receiver-only AI usage edits and the private
context-manifest persistence repository from directional protocol triggers.
Those paths previously produced a false Core/Remote cycle for this migration.
Actual changed metering contracts and context producers still compose their
opposite dependencies and reject a cycle. The plan exposes the matched and
non-trigger paths; this classification is not live compatibility evidence.
Final release planning must use each actually deployed component's source and
verified receipt. The fixed development baseline is not assumed to be deployed.

The writer inventory above is preparation only. There is no implemented or
accepted complete freeze/drain executor yet. Once a real workstation execution
can be admitted, rehearse closure at the owning admission entries while the task
is active. Fresh accepted/running evidence must keep it alive; use its normal
stop path only if needed. Reconcile the RuntimeCoordinator in-flight index and
execution identity with its final receipt, visible Space outcome and remaining
outboxes. Separately prove producer/schedule closure, queue/workflow/alarm/socket
settlement and remaining relational writer quiescence. A quiet screen, rejected
new Wake, historical final ledger row or missing head alone does not prove drain.

For an interrupted maintenance, retain the exact phase, source identity, frozen
source/capture receipt, import receipt, authoritative executions/outboxes and
DO/R2 effects. Resume only from matching evidence; an unknown phase stays closed.
In a disposable rehearsal, interrupt before capture, during import and after the
first normal PG write, then verify safe recovery at each owner. Existing COPY
process-kill tests prove database rollback only, not this cross-owner recovery.
No time estimate or automatic reopening is justified before that rehearsal.

Actual promotion stays closed until source identity, complete writer freeze/drain,
final export/import/reconciliation, permissions, cloud product acceptance and
recovery evidence all exist. There is no parallel deploy command.

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
