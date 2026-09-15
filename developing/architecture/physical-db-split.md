# OpenMeld Physical DB Split

## Agent Context

- Purpose: Define the current physical database direction and the boundaries
  for any future split, without letting agents execute the superseded 4-way
  split as a live plan.
- Read this when: You are creating or renaming D1 databases or bindings,
  writing per-DB migrations, changing `ops_decisions` persistence, or planning
  evidence-growth control.
- Update this when: Felix changes the physical database direction, the future
  observability-only split becomes active, or a new durable table affects the
  physical storage owner model.
- Do not use this for: Product semantics (see `product-model.md`), execution
  authority (see `agent-transport-contract.md`), logical data ownership rules
  (see `data-and-observability.md` — this file inherits and never overrides
  them), or Cloudflare operations how-tos.
- Source of truth: This file owns physical D1 split direction. The live
  direction is a single `openmeld-db`; the 4-way split is superseded history.

## Current Status

As of 2026-06-14, Felix reverted the 4-way physical D1 split direction. The
live production direction is a single `openmeld-db` binding (core rollback commit
`593e71dd`, production-smoked). Do not resume the 4-way split, its Stage A-F
runbook, or the 4-database target layout. The full 4-way design, decision
record, migration runbook, and dated execution log live in this file's git
history (revisions before 2026-07) and are not an executable plan.

Why the split is not urgent: the bloat root cause was fixed independently of
any split — the `openMeldDaemon_ops_decisions` upsert (latest row per correlation) plus
a one-off cleanup took `openmeld-db` from 587 MB / 512K rows to 19 MB / ~890 rows.
The 10 GB D1 cap is not in sight. Logical data ownership continues to follow
`developing/architecture/data-and-observability.md` unchanged.

`openmeld_profile_deletion_outbox` is Auth-owned identity-lifecycle recovery
state and is currently co-located in the shared `openmeld-db`. It is not
retained Wake evidence and must not move into a future time-decaying
observability database.

## Groundwork Kept On Purpose

These remain as harmless no-ops on the single DB and are reusable by a future
observability-only split. Do not clean them up as dead code:

- Per-domain accessors `localStateDb` / `wakeEvidenceDb` / `projectionsDb`,
  all falling back to `OPENMELD_DB`.
- `dispatchRecoveryDb`, which deliberately resolves only `OPENMELD_DB`.
  Pre-head failure-publication commands, claims, retry schedules, and completion
  gates are operational recovery state and must not follow `wakeEvidenceDb`
into a time-decaying observability database.

The bounded `openmeld_service_connection_incidents` table is Diagnostics-owned
evidence accessed through `wakeEvidenceDb`, currently on the shared database.
Its own daily retention only deletes that table; it does not activate the old
split-gated sweep or change any database binding.
- The dispatch hot-path cross-domain fix (commit `ca9680d8a`) that routes
  ledger↔binding correctly — the one boundary an observability split still
  needs.
- The split-gate verification net.
- The provisioned but unused `openmeld-wake-evidence` database, kept for the future
  observability split. The other three provisioned databases
  (`openmeld-local-state`, `openmeld-projections`, `openmeld-identity`) are disposable.

The old 4-way split copy/backfill tool was removed during the OpenMeld
greenfield reset. It copied data from an existing shared database into the
superseded 4-database layout and must not be recreated unless Felix explicitly
reopens a new physical split plan from current production facts.

## Future Direction (Not Built Now)

If a physical split ever becomes necessary, split observability only: isolate
Wake evidence into `openmeld-wake-evidence` when post-retention growth approaches
the D1 size cap again.

Per-domain levers before reaching for a split: projections → rebuild or shard
per account; evidence → shorten retention or archive to R2; identity/config →
shard per tenant, or move that single domain behind Hyperdrive → PostgreSQL.
The Hyperdrive/PG trigger is any database at or above 6 GB post-retention, or
a query shape D1 cannot serve. Until then stay D1-first, and keep
identity/config schemas free of SQLite-only features so portability stays
free.
