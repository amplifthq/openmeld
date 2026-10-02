# Shared Relational Database Direction

## Agent Context

- Purpose: Own the physical relational database target and current compatibility boundary.
- Read this when: Planning PostgreSQL persistence, migrations, bindings, or data cutover.
- Update this when: The physical target, current product bindings, or cutover boundary changes.
- Do not use this for: Execution authority, product semantics, or operational commands.
- Source of truth: This document owns direction; [the PostgreSQL workflow](../engineering/postgresql.md)
  owns commands and acceptance; `tooling/postgresql/resources.json` records provisioned targets.
- Logical ownership remains in [data and observability](data-and-observability.md).
  This document does not authorize production changes or resource deletion.

## Decided Target — 2026-10-03

Felix selected **Cloudflare Hyperdrive + PlanetScale PostgreSQL** for OpenMeld's
shared business relational database. All databases belong to the **Amplift**
PlanetScale organization (`amplift`), with separate staging and production
resources and credentials. This supersedes D1-first planning, the 6 GB migration
trigger, and the observability-only split as the future target.

Current product production and shared staging still use D1. Production's
`OPENMELD_DB` resolves to `openmeld-db-prod`
(`15f16284-5240-4675-b626-3b7144e1d684`); staging uses `openmeld-db-stg`
(`10da3483-0644-459a-8523-381a2a17ac39`). PostgreSQL foundation resources are
isolated and contain no production user data. Provisioning is not product cutover.

Use standard PostgreSQL drivers through cache-disabled Hyperdrive for Workers
and direct TLS connections for migration and backup owners. Do not build a
permanent D1 API emulator. Preserve D1 history and create independent PostgreSQL
migrations. Commands, grants, backup/restore and the controlled maintenance-window
cutover belong to the PostgreSQL workflow.

## Ownership And Compatibility

RuntimeCoordinator owns execution; the relational Dispatch Ledger remains
evidence and a projection. Space Durable Objects retain realtime state and
outboxes, R2 retains file bodies, and OpenConnector's upstream database is
outside this migration. Retention follows business owners, not physical storage.
Cutover must establish one relational authority without prolonged dual writes,
preserving IDs and DO/R2 references.

Current per-domain D1 accessors and aliases remain necessary compatibility
surfaces until their consumers migrate. Do not remove them during foundation
setup. `dispatchRecoveryDb` is operational recovery state; the Auth-owned
`openmeld_profile_deletion_outbox` and account notification preferences are
product state. Neither becomes time-decaying evidence merely by sharing a database.
Diagnostics-owned connection incidents retain their own bounded retention.

The former four-way D1 split and observability-only split are historical,
superseded plans. Their detailed runbooks remain in Git history. Existing
unused resources are not permission to delete anything. Inventory and authorize
cleanup separately from PostgreSQL preparation.
