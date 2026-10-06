# Historical OpenMeld D1 Migration History

This directory preserves the immutable migration history and snapshots of
OpenMeld's pre-cutover shared D1 database. Production has used PostgreSQL since
2026-10-04. Shared staging remains on its deployed D1 revision; current-source
staging deployment is blocked pending a separate migration.

The original greenfield baseline is `0000_openmeld_initial_schema.sql`.
`meta/_journal.json` and the snapshots describe the historical SQLite schema.
The D1 `d1_migrations` ledger identifies applied files by name. Do not rename,
delete, reorder, squash or rewrite those files or snapshots: source verification,
capture/import tooling and recovery evidence still depend on them.

New shared-schema work belongs to `packages/db/postgresql/migrations` and
`packages/db/postgresql/drizzle.config.ts`. Root `db:generate` now generates
native PostgreSQL migrations; it does not extend this historical directory.

Use the [PostgreSQL workflow](../../../developing/engineering/postgresql.md)
and [production release owner](../../../developing/engineering/production-release.md#production-database-release)
for current operations. The legacy `db:release:prod` and `db:sync:prod` commands
reject the PostgreSQL manifest. Do not point production back to frozen D1 after
PostgreSQL has accepted new writes; follow the
[cutover recovery boundary](../../../developing/engineering/postgresql-cutover.md#current-production-state).
