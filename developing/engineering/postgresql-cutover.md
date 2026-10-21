# PostgreSQL Cutover And Recovery Record

## Agent Context

- Purpose: Track production cutover evidence, historical rehearsals, writer-freeze procedures and recovery boundaries.
- Read this when: Preparing a migration rehearsal, inventorying writers, or reviewing maintenance and recovery evidence.
- Update this when: Capture/import contracts, writer coverage, rehearsal evidence or the guarded release plan change.
- Do not use this for: Authorization to export production data, deploy, freeze active Spaces or switch database bindings.
- Source of truth: Native and historical journals own storage; RuntimeCoordinator owns workstation execution; the existing production release owner owns deployment and leases.

## Current production state

The explicitly authorized maintenance window completed the production D1 to
Hyperdrive + PlanetScale PostgreSQL cutover on 2026-10-04. Production's sole
shared relational authority is `amplift/openmeld-postgresql-prod`, branch `main`,
on PostgreSQL 18. Hyperdrive `dba7d43fe644409c8e1cc24c5260f289` has query caching
disabled. Shared staging, OpenConnector's upstream database, Space Durable Object
storage and R2 file-body ownership were not migrated by this relational cutover.

The final frozen source contained 160 tables and 360,512 rows. Import
`93374a48-9760-4482-ab89-7e2b222c3ce9` reconciled all tables and values against
that source, with 16 native journal entries and five identity mappings. The
frozen export SHA-256 is
`4776b87add5053774e13ab192ea2ca6a82999ed2c2ce060f46b07794d3ad8df3`.
The original D1 database retains 480 write guards across those 160 tables.
PlanetScale backup `j6lskkxwdl9p` completed successfully at 10:17:09 UTC.
Preserve this dated evidence; later PostgreSQL product writes are not expected
to match the frozen D1 snapshot.

The guarded database receipt is `7274e1c25f1461d778a6934e2a296ca4460e4950`.
Official CLI publication [workflow 37203295108](https://github.com/amplifthq/openmeld/actions/runs/37203295108)
published CLI and Service 0.3.241 from
`a2a57cb3fd04b2555575b60ace25a6d6dca315a4`. Final Core source
`585184c808cf88810acd332eef7b366883d08cfa` is deployed as version
`204fd036-4f16-4e99-b7ec-0b5fa212d7e4`, with verified receipt
`1f311a527f036ee3fcc9493a9702abd23f8b986d`.
The maintenance ingress rule was disabled, both Queue consumers resumed, and
normal Auth/Core schedules were restored. The 13:07 UTC readback confirmed
empty Queue backlogs and the expected production bindings and deployment identities.

Production acceptance includes authenticated Web reads, CLI and installed
Service 0.3.241, My Files and Space Files upload/download integrity, and a native
Agent reply that appeared in Inbox, opened the exact reply, and retained its
read state across reload. Those receipts do not imply external integration or
Team Files end-to-end coverage. Follow-up Web and Desktop publication evidence
is recorded with the corresponding Changelog entry.

A separate real workstation Wake used OpenCode's `opencode/mimo-v2.6-flash-free`
model through installed Service 0.3.241. Dispatch
`7830f973-8e33-4184-9bf6-a02bef50e76c` produced the exact requested marker in
reply `03ef7923-945b-4be5-8d63-5670424dad66`; the supported CLI trace links the
local runtime, completed process, coordinator execution and published reply.
The post-terminal head lifecycle was unavailable, so this receipt does not
prove a live in-flight head read.

Production UI acceptance also observed a recovered initial load stall. A bounded
13:25–13:38 UTC Core/Auth log query found successful ordinary Auth and Inbox RPCs
taking about 10–12 seconds, without error-level logs in that sample. The latency
root cause and its resolution remain unproved; runtime-report durations are not
database-query durations. This occurrence is retained separately from functional
acceptance and was not used to justify another deployment or capacity change.

PostgreSQL has accepted new business writes. Do not rerun import or frozen-D1
reconciliation against live product state, remove the D1 fence, or point readers
and writers back to D1. Recovery now requires a fresh freeze and preservation of
new PostgreSQL writes, including matching DO/R2 effects, or a forward fix.
Resource deletion and shared-staging migration require separate authorization.

## Historical preparation boundary

The local PostgreSQL product milestone was commit
`6f3f178e28accaec7f00dcfa8abba8a9677abeb0` while PR 1460 was a draft. Its real product
evidence and unresolved Worker-pool limitation are in
[the PostgreSQL workflow](postgresql.md#pre-cutover-preparation-status).
That work prepared a later maintenance window while production Spaces kept
running on D1. There is no production data export, writer freeze, product
deployment or database cutover authorization here.

The delivery target is a coordinated night-time cutover for a small internal
test group. Longer downtime, normal Stop of internal tasks, signing in again
and retrying low-impact operations are acceptable. Preserve data, files,
permissions and product behavior. An automated drain certificate, general
maintenance orchestrator and arbitrary interruption recovery for every callback
are not prerequisites.

The accepted frozen-data rehearsal used PostgreSQL commit
`b0748d8b60227410ce87d67dfe382de2403dc07a`. Its immutable D1 history matches
the D1 preparation base `c682d417d1327482b4fc8ebffe9a5cac02a8f55e` and
maintenance candidate `da519d956d29198b68364c893dd394468ccfceb4`: no SQL
migration differs. The history SHA-256 is
`9eb9face4c014a7da2520258abcb40aa9b24ccec8c0977d1a006f5ffea071893`.
The PG target uses the canonical journal through `0013_d1_import_completion`.
These remain the provenance of that accepted rehearsal, not a claim about the
final source candidate or the history actually applied in production.

The first source integration uses fixed main
`02351f6685b43bdf7cd4c752df41e805ccc6fe35`. Its new D1 migration
`0191_powerful_lord_hawal` replaces the unique delegation index on
`center_agent_wake_publications` with an ordinary index for multi-Space batches.
The new native migration `0014_batch_wake_publications` makes the same change;
no previously recorded PostgreSQL migration is rewritten. A complete batch is
inserted in one native transaction before any destination is attempted, while
the existing publication ID and immutable command checks retain retry identity.
Targeted checks cover batch recovery, current Queue/Steer and Stop authority,
Agent Direct Messages, editable reply placement, and Organization knowledge
access. The earlier local product and isolated cloud receipts remain scoped to
their recorded revisions; this source integration does not repeat or broaden
those deployment claims.

The final database integration uses the subsequently reviewed fixed main
`edcaf1a00ba30a13b447e9dda28fd08383c1f69e`. D1 `0192_lush_rick_jones` adds
`plugin_action_requests` and the action-operation connection version; native
`0015_plugin_action_requests` preserves both. Plugin approval, Inbox resolution,
delegated authorization and durable replay claims use the PostgreSQL owner and
transactions. Targeted native checks pass 34 database-boundary cases, 63 Worker
Plugin/Files cases and three exact execution-proof/working-folder cases.
The isolated frozen capture includes populated approval and operation records
and all 160 current historical tables with 480 write guards. Capture must still
match the schema and history actually deployed at the maintenance window; a
main commit is not evidence that its D1 migration ran. Do not chase additional
main changes during this candidate's closeout.

Final Candidate preparation subsequently integrated reviewed main
`114866ca9fdce7d9c7c2167b0eea30acc0ba0587`. Its Remote Agent context and
dependency-patch increment changes no database schema or migration. The native
database receipts above retain their original revisions; this final dependency
integration does not repeat cloud or migrated-product acceptance. The reviewed
validation-control diff remains unchanged and uses the existing explicit local
bootstrap, with the final exact head and live main identity checked by the
trusted controller.

The Queue/Steer integration fixture initially passed all 26 assertions but
exited with `ECONNRESET` while the Worker runtime shut down. It now waits for
its own `waitUntil` work before deleting its alarm and restoring mocks. Three
consecutive ordinary runs against fresh PostgreSQL clusters passed all 26
assertions and returned exit 0. No exception suppression, retry setting,
arbitrary delay or product behavior change was used. This scoped fixture fix
does not establish a Miniflare defect or resolve the separate long-lived
Worker-shard limitation recorded in the PostgreSQL workflow.

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
synthetic captures remain supported. The remote entry below uses the same owner
and requires the registered source plus frozen maintenance identity. It has not
exported production data.

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
cover Web/Auth, permissions, a migrated Wake and retained DO/R2 content. The
[isolated cloud business-owner rehearsal](postgresql.md#existing-foundation-business-owner-rehearsal)
also passed through Worker / Hyperdrive / PlanetScale on 2026-10-04, including
actual Auth Profile and Core Project persistence and permission decisions. Its
temporary Worker was removed and the database evidence retained. A verified
stopped legacy product source and complete cloud product acceptance remain open.
The isolated database rehearsal has no attached product runtime and cannot prove
its shutdown.

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

The 2026-10-03 migrated Codex Wake attempt was rejected before execution with
`usage_exhausted`, while Binding, Runtime and Service evidence was ready and the
route was online. An independent current account-limit read confirmed 100% use
of the ordinary Codex weekly window and `creditsAvailable: true`. OpenMeld's
current usage admission rejects this Codex Wake; this does not establish that
paid capacity is unavailable. The lane had no other existing workstation Agent
Profile. This is historical admission evidence, not the current migrated-Wake
result below. The quota was not bypassed.

On 2026-10-04, candidate `32804937e6f3af38a7cf73c6d46c8f72ce32dd44`
captured the same 425-row retained-product sample from actual local D1 with all
477 write guards installed. The frozen source SHA-256 is
`b0c02a7891605c2db6ae1bd0a36af8bbb66f542e13460b33a720823ac39704d1`.
Normal Web password login, existing Space messages and exact file contents
passed. A normal CLI Wake of the existing Codex Profile executed and published
the visible reply `Frozen D1 PostgreSQL migration confirmed.`:

- Dispatch: `b612a1b3-448a-4930-af01-3a79cd7c2a52`.
- Client message: `d2849885-71de-43ed-9e91-9234955c83d0`.
- Reply signal: `e7b4b531-7bcb-4063-b68c-a38d5ab8139b`.
- Trace: `visible_reply`, `reply.delivered` and coordinator `reply_published`.

No model, quota, permission or Profile substitution was used. The post-terminal
head read remained unavailable, so this proves execution and publication, not
an authoritative in-flight drain observation. One Inbox projection primary-key
warning recovered through the existing outbox; exactly one item appeared and
its read state persisted. The occurrence was recorded without expanding this
candidate into an unreproduced concurrency fix.

After normal whole-stack stop/start, the target retained the Project rename,
Inbox read state and identical import receipt SHA-256
`b6b62adac144d5a97d22c45c10f13a439f38fb131b6c72809c76607bae65815a`.
The first restart left Web page requests unresponsive while Auth/Gateway and
native database reads worked. One normal restart retry initially showed the
same symptom; static assets responded before page rendering recovered. The
original Chrome session then reloaded the Space with the exact reply visible
and Inbox caught up. The startup delay's cause is not established or fixed.
Do not equate a listening port with Web readiness. No data reset or reimport
was used. Tasks were observed only in their empty read view; task mutations and
external integrations are not covered by this product sample.

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
both owners for upgrade tests; the registered production target requires the
repository journal. The external `d1-import.json` is only a checked projection, written by an
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

The cutover release options in this section (`release:plan --database-cutover`,
`--database-cutover-snapshot`, and `--database-cutover-restore-crons`) were
retired with the previous release engine. The section records how the cutover
ran; current PostgreSQL releases use `pnpm run deploy -- --scope db`.

The existing `release:plan -- --database-cutover --base <fixed-baseline> --json`
entrypoint now produces a read-only PG preparation plan. It reuses the existing
source-impact and rolling-order owners and the native migration journal reader.
The plan contains registered target identity and hashes, not live cloud evidence.
All preparation step arrays are empty, promotion is false, and evidence remains
`not_evaluated`. A separate snapshot option below admits a real frozen import
through deploy/preflight. The
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
   through the snapshot-admitted release below. Keep entry traffic closed until
   versions and bindings agree. The derived maintenance configuration prevents
   deployment from restarting Cron. No component may keep writing relational
   data to D1.
6. Check old-account login, permissions, Organization/Space/messages, a real
   Agent reply when quota permits, Files, Inbox/tasks, enabled integrations and
   restart persistence. Reuse valid existing evidence; add missing migration
   and Hyperdrive coverage. Explicitly restore Cron, then reopen sources in the
   recorded order and preserve the frozen D1 source plus capture/import receipts.

### Executable maintenance-window entries

These commands are for the separately authorized window and have not run against
production. Use the exact reviewed clean candidate, existing release credentials
and local release leases, one operator, and a private evidence directory. Hosted
Auth/Core/database releases remain blocked. After the local cutover and Cron
restoration, the existing hosted CLI workflow can publish only against verified
Database/Auth/Core receipts for the same native database contract and matching
live deployments and Hyperdrive configuration. It neither performs a migration
nor receives private capture data or migration credentials. Do not add business
data to the repository. The data CLI resolves the fixed Amplift database/branch
and migration role from `resources.json`, verifies live PlanetScale IDs and reads
the scoped Doppler migration credential. Cloudflare reads require
`CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN` with D1 read, Hyperdrive read and Worker
schedule read permissions. Existing deployment credentials remain required.

```sh
# Offline inventory only.
node tooling/postgresql/cutover.mjs plan

# After normal Stop/wait, producer closure and writer/outbox checks:
node tooling/postgresql/cutover.mjs prepare-barrier <maintenance-id> <private-directory>
# Review the returned config and SQL, then apply with official D1 migrations.
pnpm exec wrangler d1 migrations apply openmeld-db-prod --remote --config <returned-config>
node tooling/postgresql/cutover.mjs inspect-barrier <maintenance-id>
node tooling/postgresql/cutover.mjs capture <maintenance-id> <private-snapshot.sqlite>

# Native PG18 journal, then one atomic COPY/reconciliation transaction.
node tooling/postgresql/cutover.mjs migrate
node tooling/postgresql/cutover.mjs import <private-snapshot.sqlite>
node tooling/postgresql/cutover.mjs grant-runtime
node tooling/postgresql/cutover.mjs verify
node tooling/postgresql/cutover.mjs completion <private-snapshot.sqlite>
node tooling/postgresql/cutover.mjs reconcile <private-snapshot.sqlite>

# Data backfill after its migration; preview, then commit.
node tooling/postgresql/cutover.mjs backfill-member-agents --dry-run
node tooling/postgresql/cutover.mjs backfill-member-agents

# The coordinated db,auth,core release and Cron restore used the retired
# --database-cutover-snapshot and --database-cutover-restore-crons options.
```

The snapshot is created exclusively with mode `0600`. Its adjacent JSON manifest
binds source identity, frozen barrier, history, typed cells and hashes.
Barrier inspection recognizes exact captured local and production D1 platform
definitions (`_cf_METADATA`, `_cf_KV`) and SQLite's `sqlite_stat1` statistics
table. These are preserved without application write guards or PG import;
unknown objects and changed definitions still stop admission.
`OPENMELD_PG_RECEIPT_PATH=<new-private-file>` optionally saves command output with
the same exclusive permissions. External output is a projection: only the import
completion row committed with COPY is completion truth. `completion` reads that
row; `reconcile` compares current fields and generators with the snapshot.
Neither proves DO/R2 convergence or opens traffic. API failures, 429 responses
and uncertain imports stop without automatic retry or target reset.

First product admission runs under existing production leases. It checks both
candidate bindings, frozen D1 guards, committed import, full reconciliation,
native journal, runtime grants, cache-disabled Hyperdrive and paused Cron, then
rechecks the guards. The database deployment step verifies the import instead of
running legacy D1 migrations. Source, artifact, CLI compatibility, component
receipts and directional protocol gates remain in force. Later PG releases
require verified Auth/Core receipts with matching active deployments and PG
source bindings. Their database stage uses native migrate/grant/verify; Core
checks the exact native journal and grants before activation.

The release owner derives `.openmeld-pg-cutover.jsonc` beside each original
Auth/Core config. Only `env.prod.triggers.crons` changes to `[]`; the same directory
preserves relative entry/build paths. Auth deploy, Core version upload, atomic DO
migration, later Core trigger sync and CLI projection publication use it and
retain existing receipts. Cleanup never restores Cron. If interrupted cleanup
leaves a derived file, inspect and remove it before retrying; the owner refuses
to overwrite it. It does not accept arbitrary override configurations.

The restore command requires the exact candidate's verified Auth/Core
deployments, native readiness, normal release checks and both scope leases.
It syncs the candidate's normal triggers and reads back both schedule lists.
Ordinary PostgreSQL releases require those normal schedules already present;
they cannot implicitly reopen paused Cron during product acceptance.
Cron changes can take about 15 minutes to propagate. An empty API list does not
prove an already-running job ended and does not pause Queues, Workflows, DO alarms
or sockets. Keep the writer inventory and normal in-flight checks above.

Local validation covers remote API envelopes/error refusal, source/credential
identity, actual isolated frozen D1 to native PG import, grant denial, native
release-step selection, derived configuration equivalence and Core deployment
branches. Actual Auth and Core maintenance bundles pass Wrangler dry-run.
This is not a managed-production import, shutdown or full cloud product smoke.

The data bridge, local migrated product paths and isolated Worker → Hyperdrive →
PlanetScale business-owner checks above have passed. They do not prove a full
cloud product deployment or the shutdown of a legacy D1 source. Review exact
targets, bindings, credential scope and commands before newly required cloud
operations. At the time of those preparation receipts, production and shared
staging were outside their scope; the later production window is recorded above.

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
