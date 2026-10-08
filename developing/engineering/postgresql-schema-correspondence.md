# PostgreSQL Product Schema Correspondence

## Agent Context

- Purpose: Define how the native PostgreSQL schema preserves the shared product storage contracts.
- Read this when: Changing native schemas, importing historical D1 data, or reviewing ownership, constraints, and retention.
- Update this when: The native journal, final historical schema, deliberate representations, or owner guards change.
- Do not use this for: Production cutover authorization, live data repair, or execution authority.
- Source of truth: The immutable D1 journal and current PostgreSQL schemas and migrations own the storage contracts; this document records their reviewed correspondence.

## Boundary and evidence

The PostgreSQL 18 candidate preserves the final shared relational schema from
the immutable SQLite/D1 journal. It does not migrate production rows, deploy
the product, or change private Durable Object SQLite storage. Fresh local test
databases apply the complete native Drizzle journal before runtime-role tests;
they do not translate SQLite SQL or select a reduced table baseline.

The schema audit applied the historical SQLite journal to a disposable
database and read its final `sqlite_schema`, table, foreign-key and index
metadata. It separately applied every native PostgreSQL migration and read
`pg_catalog` and `information_schema`. The comparison covered the following:

| Surface | Correspondence |
| --- | --- |
| Tables | 160 shared product tables; columns and primary-key order match |
| Nullability | No non-primary nullability change or primary-key tightening |
| Foreign keys | 189; referenced columns, delete actions and update actions match |
| Named CHECK constraints | 557; all names resolve to their PostgreSQL counterpart |
| Named indexes | 374; uniqueness, key columns and direction match, including the explicit Inbox ordering key below |
| Partial indexes | 29; predicates reviewed with their owner conditions |
| Expression indexes | None in the final historical schema |
| Unique constraints | No missing historical unique constraint |
| Views | None in the final historical schema |
| Triggers | Three historical triggers map to two native trigger owners |

The final source audit uses fixed main
`edcaf1a00ba30a13b447e9dda28fd08383c1f69e`, D1 history through `0192`, and
native PostgreSQL history through `0015_plugin_action_requests`. Migration
`0014` preserves the non-unique batch Wake index from D1 `0191`; `0015`
preserves the Plugin request table, its two indexes and Organization foreign
key, plus the nullable connection-version timestamp on action operations.
No earlier migration is rewritten. The earlier 159-table product/cloud receipts
retain their original source identities. Frozen physical diagnostics under
`d1-history` remain explicitly pinned to their pre-port revision; capture and
maintenance admission compare the actual source with the immutable SQL journal,
not those diagnostic projections.

CHECK comparison found 502 expressions with corresponding ordered tokens after
the reviewed syntax changes. Another 54 pairs were reviewed semantically:
SQLite GLOB exclusion becomes a PostgreSQL regular expression; JSON validity
and shape use native JSON predicates; BETWEEN and generated expressions retain
their boundaries. The one deliberate welcome-retry correction is documented
below. This structural and semantic audit complements business
tests; it is not an exhaustive mutation test of every constraint.

PostgreSQL truncates identifiers to 63 bytes. Nineteen historical index names
and 55 CHECK names are longer, all ASCII. Their truncated names remain distinct;
the complete native schema has no resulting collision. Diagnostics and future
migration SQL must use the actual PostgreSQL names.

## Deliberate native representations

Migration `0027_project_workflow` adds Project preferences, the nullable Linear
operation receipt, and two key-only Task/Project projections. Historical Project
IDs, repositories and permissions remain unchanged. The historical D1 importer
initializes the new preferences with null destinations, zero revisions and empty
lists, and does not invent provider receipts or Task associations. The two new
projection tables participate in native inventory and fresh-target emptiness
checks; read-only reconciliation preserves later PostgreSQL writes.

Migration `0016` adds the PostgreSQL-only `cloud_computers` account directory.
It has no historical D1 rows. The D1 importer explicitly includes this table in
its native inventory and fresh-target emptiness checks, while copying and
reconciling only historical tables. Read-only reconciliation leaves new Computer
records untouched. Unknown or missing native tables still reject the import;
the native migration journal remains the authority for the current schema.

Public text IDs, epoch milliseconds, integer `0`/`1` flags, encrypted envelopes
and JSON text remain in their owning contracts. Five historical generated
integer keys use PostgreSQL identity columns. Inbox's explicit sequence replaces
its shared SQLite sequence mechanism. Nine Auth key defaults use native UUID
generation without rewriting supplied IDs.

The Inbox observation index contains recipient, Organization and `sequence`.
SQLite implicitly appends rowid to the historical two-key index; PostgreSQL
needs the insertion-order key explicitly for the same scoped watermark lookup.

Timestamp defaults use `floor(extract(epoch from clock_timestamp()) * 1000)`
before converting to bigint. A direct cast would round and could introduce a
millisecond that the SQLite default did not produce. Runtime bigint reads fail
closed outside JavaScript's safe integer range. Numeric aggregates remain under
their business owner: counters and tokens require an explicit safe integer;
money keeps its precise representation. There is no global numeric-to-float
conversion.

JSON CHECKs use native `IS JSON`, `IS JSON ARRAY` and `IS JSON OBJECT`. Array
length checks guard validity and shape before `json_array_length(...::json)`.
The schema accepts JSON text without silently imposing jsonb's stricter numeric
or escaped-NUL representation. Queries that need extraction must choose the
appropriate native representation at their own boundary.

The repository URL CHECK uses `ILIKE` to preserve the historical acceptance of
an uppercase HTTPS scheme. Organization join requests retain `NO ACTION` for
their applicant user reference; changing it to CASCADE would silently remove
pending requests during account deletion.

## Canonical owner guards and concurrent writes

The Binding INSERT and UPDATE guards share one native trigger function. It
rejects invalid Profile identity or mismatched account/Organization ownership
at the persistence boundary. Profile deletion enqueues its reconciliation
outbox in the same transaction: rollback preserves the Profile and removes the
new intent; commit makes the deletion and intent durable together. Duplicate
deletion notifications reconcile through the existing outbox identity.

PostgreSQL permits concurrent writers. A predicate that happened to be atomic
under D1's single writer does not by itself serialize two PostgreSQL requests.
Binding ensure, reconnect and controller-conversation update lock the canonical
owner's `users` or `organizations` row before the guarded write. The subsequent
statement uses a fresh READ COMMITTED snapshot. Two Profiles claiming one owner
and controller conversation converge to one winner and one explicit conflict;
the same rule applies when updating existing Bindings. Historical duplicates
are not rewritten, and the lock does not introduce a second identity or
execution authority.

## Wake evidence retention

Core's native retention owner implements the current two-table policy in
`developing/architecture/physical-db-split.md`: 30-day creation diagnostics and
allowlisted historical events from fully published executions. Each table gets
at most five batches of 1,000 deletions. Eligibility and deletion share one
statement; retained execution projections and result receipts supply the evidence.

Cancellation fences, token evidence, failed or running executions, operational
ledgers, results and recovery records never expire through this sweep. Physical
consolidation does not grant new execution, finalization or replay authority.

## Validated correction to the welcome retry contract

Native OAuth tests expose an existing conflict: the welcome preparation owner
sets `ready` with `slack_delivery_retry_authorized` after an installer reauthorizes
a failed delivery, while the historical CHECK allowed only a null failure code
for `ready`. Migration 0008 permits that one explicit authorization marker in
`ready`; other failure codes and the queued, researching and completed shapes
remain constrained. The journal and Drizzle schema record this deliberate
contract correction, rather than silently weakening CHECK validation.
