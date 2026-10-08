---
name: postgresql-planning
description: Plan and implement OpenMeld PostgreSQL business persistence, schemas and migrations, transactions, Hyperdrive access, and data cutover. Use for the shared relational database transition or PostgreSQL work; not for unrelated D1 performance fixes or OpenConnector's upstream database.
---

# OpenMeld PostgreSQL Planning

All OpenMeld databases belong to the **Amplift** PlanetScale organization
(`amplift`), never the operator's personal organization. Pass `--org amplift`
explicitly; login defaults are not the resource owner.

The architecture is decided: Cloudflare Hyperdrive connects Workers to
PlanetScale PostgreSQL. Start from current source, not a new vendor comparison
or the superseded D1 capacity threshold. Production has used PostgreSQL since
the 2026-10-04 cutover. Shared staging reuses `openmeld-postgresql-stg` through
its own Hyperdrive binding and the guarded `pnpm staging:deploy` workflow.
The former staging D1 database is retained for historical test-data inspection.
Use standard PlanetScale Postgres for this foundation. Neki preview enrollment
does not change the chosen engine or authorize a sharded database migration.
The staging/local baseline is PostgreSQL 18 at the latest supported stable minor.
Use older versions only for a demonstrated compatibility constraint.
Production capacity changes require measured demand. Keep capacity stable while
isolating code-path regressions; use the current workflow's metrics and query
plans before recommending a larger machine.

## Shortest useful start

1. Read [physical database ownership](../../../developing/architecture/physical-db-split.md)
   and the applicable section of the single
   [PostgreSQL workflow](../../../developing/engineering/postgresql.md).
2. Run `pnpm pg plan` to see exact targets and migration checksums. Check
   `tooling/postgresql/resources.json`; a planned name is not a created resource.
3. Read the touched business owner's source, schema and contracts. Define who
   writes each fact and which readers need a transaction. Do not recreate
   RuntimeCoordinator authority, Space Durable Object state, or R2 file bodies.
4. Implement in the existing owning package. Use standard PostgreSQL SQL and
   the supported `pg` driver; do not build a D1 API emulator or a cross-database
   framework. Preserve externally visible IDs and shared schemas.
5. Run `pnpm pg:check` for database infrastructure changes. For business work,
   add the smallest real PostgreSQL behavior checks for its failure boundary,
   then exercise affected consumers. Local infrastructure acceptance is not
   proof of cloud connectivity, production scale, or completed business migration.

## Decisions that change implementation

- Application Hyperdrive caching is disabled. Transactions use one client from
  BEGIN through COMMIT/ROLLBACK. Hyperdrive transaction pooling cannot preserve
  session settings, temporary tables, or session advisory locks between queries.
- Migrations and backup tools use the direct TLS endpoint on port 5432. A
  single migration owner and PostgreSQL advisory lock serialize changes.
- Keep PostgreSQL baseline/migrations under `packages/db/postgresql/migrations`.
  Never convert or edit already-applied D1 history in place. Review generated
  SQL for SQLite assumptions, timestamp units, JSON, ordering, conflict behavior,
  indexes, constraints and affected query plans.
- Runtime roles receive only owning-schema/table grants. No default `postgres`,
  broad all-data roles, CREATE, TRUNCATE, role management or migration ledger access.
  Tenant authorization remains an explicit owner contract, not a schema name.
- Use the workflow's exact target and Doppler allowlist. No credentials in
  Git, logs, chat, command arguments, or ordinary development environments.
- Retain historical test data where practical, but synthetic staging acceptance
  does not authorize exporting production data into staging.

## Before applying or cutting over

Use the workflow's migration and cutover checklist rather than copying it here.
Check source identity, target identity, immutable migration checksums, lock
ownership, runtime grants, restore evidence, mixed-version consumers and one
data authority. A completed resource creation is not a completed migration.

Stop the affected operation on a mismatched environment/branch, unknown owner,
applied migration drift, failed restore, unresolved production writers, exposed
credentials, or missing tenant authorization. After PostgreSQL accepts new
business writes, reverting the binding to old D1 would lose data: freeze and
reconcile under the recovery plan. New legal agreements and payment/identity
challenges require the human. Do not request approval again for already
authorized, bounded infrastructure setup.
