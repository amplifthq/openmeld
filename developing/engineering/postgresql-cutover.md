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

The delivery target is a coordinated night-time cutover for a small internal
test group. Longer downtime, normal Stop of internal tasks, signing in again
and retrying low-impact operations are acceptable. Preserve data, files,
permissions and product behavior. An automated drain certificate, general
maintenance orchestrator and arbitrary interruption recovery for every callback
are not prerequisites.

The integration base is PostgreSQL commit
`b0748d8b60227410ce87d67dfe382de2403dc07a`. Its immutable D1 history matches
the D1 preparation base `c682d417d1327482b4fc8ebffe9a5cac02a8f55e` and
maintenance candidate `da519d956d29198b68364c893dd394468ccfceb4`: no SQL
migration differs. The history SHA-256 is
`9eb9face4c014a7da2520258abcb40aa9b24ccec8c0977d1a006f5ffea071893`.
The PG target uses the canonical journal through `0013_d1_import_completion`.
Keep these baselines fixed for this integration; review required schema deltas
instead of repeatedly following unrelated main changes.

The only selected dependency from Draft PR 1485 is its standalone D1 barrier
preparation/inspection owner. Its Auth, runtime, Queue and arbitrary-pause
hardening is not a required bundle for this cutover. Unfinished Routine work
remains in its separate worktree. The barrier is an additional relational fence;
normal shutdown and operator checks must still cover DO/R2 and external effects.

The reproducible database rehearsal captures all 159 historical tables from
actual local D1. Its 287 records populate 18 tables: accounts, sessions, users,
Organization membership, Profiles, both owner-account and hosted Center Agent
Bindings, Projects, Space references, documents/folders, Inbox state and
pagination, Agent Activity, and an opaque credential envelope. Empty tables are
included explicitly. COPY and full-field reconciliation preserve the values;
Better Auth verifies the migrated password hash. This database assertion is
not a real Web login or a claim that external credentials remain usable.

The same typed capture now accepts an explicitly identified frozen local D1
source. It verifies all 477 guards and the exact source schema before and after
capture, then archives the maintenance ledger's schema and rows in the capture
manifest. That metadata is bound by the existing import completion receipt;
neither the ledger nor its guards becomes a PostgreSQL business object. Missing
identity, missing guards and unexpected objects fail closed. Ordinary local
synthetic captures remain supported. Remote capture is still unavailable.

The rehearsal passes unknown-table, unsupported stored-type, invalid UTF-8,
NUL-text, unsafe-integer, native-constraint, value-mismatch and process-kill
cases. Failed imports leave every application table empty; a late identity
failure also rolls back an earlier sequence restart. Killing the importer
during real COPY or after inserting completion evidence but before COMMIT leaves
a clean target that accepts a complete retry. A SIGKILL after COMMIT but before
the import child emits JSON is recovered by the normal development lifecycle.

Run from the repository root with PostgreSQL 18 installed:

```bash
pnpm --filter @openmeld/postgresql --fail-if-no-match test:d1-migration
```

The command owns temporary D1 and PG state, never production state. To retain
private synthetic evidence, set `OPENMELD_D1_REHEARSAL_OUTPUT` to an absolute
directory-name prefix under an existing private directory; it creates a new
directory and writes a receipt only after every case passes. The 2026-10-04
integrated run passed all 28 recorded cases in about 56 seconds, including an
8.5-second frozen-source fixture, capture, COPY and reconciliation case, but
excluding the outer PG cluster startup. This is not a production throughput
measurement or maintenance-window estimate. The separate product checks below
cover Web/Auth, permissions and retained DO/R2 content. Migrated Wake, a verified
stopped product source and cloud product acceptance remain open. The isolated
database rehearsal has no attached product runtime and cannot prove its shutdown.

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
occurred or that DO/R2 effects are unchanged. PostgreSQL sequences are not
ordinary MVCC data: a concurrent row/sequence comparison is not a single-instant
whole-database snapshot and never certifies a writer freeze.

The importer writes one `openmeld_migration.d1_import_completion` record in the
same transaction as COPY, reconciliation and sequence restart. This tool-owned
table is separate from application grants and Drizzle's DDL ledger. It contains
no business plaintext or credentials: an import UUID, source snapshot/capture
hashes, historical and native migration identity, table counts, identity mapping,
and the actual local cluster system identifier, data directory, database name
and database OID. The runtime role cannot read or modify it. Its shared schema
belongs to `packages/schemas`; it is not a runtime or cloud admission contract.

`pnpm pg read-d1-import local <snapshot>` validates and reads this committed
record without comparing current business rows. Its recorded journal must be an
unchanged, complete ordered prefix of the current canonical journal, including
the migration that introduced completion evidence. The actual applied journal
must match the current canonical source. Later trusted migrations may add or
change application tables and identities; the original table/identity evidence
remains an immutable historical fact. Import and explicit snapshot reconciliation
still require the exact reviewed historical mapping.

Normal startup uses this same owner after the canonical migrator upgrades the
database. The local helper can pass an explicit isolated migration directory to
both owners for upgrade tests; production targets remain unavailable and the
default is the repository journal. The external `d1-import.json` is only a checked projection, written by an
atomic rename; it is never independent proof of a successful commit.

Use the existing development lifecycle and the following recovery boundaries:

1. Before capture completes, a rejected source leaves no successful snapshot or
   manifest. Preserve the source, resolve its actual rejection and capture to a
   new private path; partial artifacts are not import evidence.
2. If import did not commit, PostgreSQL rolls back all rows and transactional
   identity restarts and completion record. Inspect the empty target before retrying the same verified
   snapshot. The real COPY interruption case exercises this boundary.
3. If import committed but its external receipt was never written, normal
   startup verifies the database completion record against the exact source and
   target plus its unchanged native-journal prefix, then reconstructs only the external projection.
   The rehearsal kills the real import child before stdout; no earlier external
   receipt exists. A malformed or mismatched record or external projection keeps
   startup closed and preserves the target. A missing database record never
   permits adopting populated data from equality or an old JSON receipt. Earlier
   synthetic rehearsal databases without this record require diagnosis; tooling
   does not backfill completion evidence.
4. Once PG contains new writes, preserve that PG state. The rehearsal advances a
   real identity and changes a row; reconciliation rejects both against the old
   snapshot. Native `pg_dump`/`pg_restore` restores the resulting full database
   into a separate empty database, then compares all 159 tables, identity states
   and migration history, including the tool record. Reapply and verify runtime
   grants. A restored clone cannot reuse the original target's import identity;
   its product admission remains closed. Restarting the original development
   database retains new writes and can reconstruct a missing external projection
   from the unchanged completion record. This proves the past import committed,
   not that the current database still equals the old D1 snapshot.
5. Normal development upgrades use the official migrator. The rehearsal appends
   a migration in an isolated source copy, adding a table, identity and index;
   restart with and without external JSON preserves later business writes and
   the original completion record. Changed historical migration content or an
   applied migration absent from the trusted source still rejects startup.

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
Use a real admitted Agent execution and its final reply for migration product
acceptance when provider capacity permits. It need not remain running across
maintenance. Finish it or use normal Stop before final capture. Provider quota
blocks that row only; continue independent data and product checks without
bypassing admission or inventing a successful result.

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

Use this manual sequence. It is preparation, not authorization for cloud
mutations or a replacement for the existing release entrypoint.

1. Record the D1 source/history, PG journal, application candidate and target
   bindings. Notify internal testers and close new HTTP, webhook, scheduled and
   connector sources with supported controls. Confirm Cron changes propagated;
   preserve consumers still needed to finish accepted work.
2. Finish tasks or use normal Stop. Check original execution owners, final Space
   outcomes and retained outboxes. Pause Queue delivery and account for retained
   messages, active consumers, Workflows, sockets and relevant DO/R2 effects.
   A pause response is not proof that an invocation ended. Lark's disconnect
   deletes pending events, so do not use it while accepted events remain. Wait
   or defer the window if a writer or external outcome remains unknown.
3. Keep traffic closed, install the exact prepared D1 barrier through official
   migrations and inspect every guard. Preserve the source backup and exact
   maintenance metadata. Use typed capture, which preserves escaped text and
   Inbox identities. Missing guards, changed schema and unknown tables stop
   capture; plain SQL export is not the PG migration path.
4. COPY into the reviewed empty PG target over the direct migration connection.
   Retain the existing transaction, constraints, field/identity comparison and
   committed receipt. Failed or uncertain imports stay closed and use the
   existing inspection/reconciliation path. Archive the maintenance ledger;
   never import that ledger or D1 guards as PG application objects.
5. Switch Auth and Core together to the candidate and one Hyperdrive PG binding
   through the existing release path. Keep entry traffic closed until versions
   and bindings agree. Minimal reviewed cutover admission/configuration support
   is still required there; the plan-only option is not a deploy command. No
   component may keep writing relational data to D1.
6. Check old-account login, permissions, Organization/Space/messages, a real
   Agent reply when quota permits, Files, Inbox/tasks, enabled integrations and
   restart persistence. Reuse valid existing evidence; add missing migration
   and Hyperdrive coverage. Reopen sources in the recorded order and preserve
   the frozen D1 source plus capture/import receipts.

Before candidate review, run the data bridge and missing product paths locally,
then validate Worker → Hyperdrive → PlanetScale in the authorized isolated
foundation environment with synthetic data. Direct local PG and the earlier
connection-only cloud probe do not prove the full cloud product. Review exact
targets, bindings, credential scope and commands before newly required cloud
operations; production and shared staging remain outside this preparation.

Final acceptance covers one stable candidate's necessary database/contracts
and main product paths, the manual runbook and unresolved evidence. Data,
permissions and a single relational writer are hard gates. Independent
low-impact improvements can follow. Do not create another execution truth,
reset business clocks or mark unknown tasks complete.

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
