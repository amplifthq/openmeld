# OpenMeld Shared Database Layer

`packages/db` owns the shared PostgreSQL schema, repositories and migration
history. Auth and Core own their respective tables; sharing a database does not
authorize cross-domain writes. Gateway aggregates authorized read projections.
Shared wire contracts belong to `packages/schemas`.

## Current storage and owners

Production Workers use `OPENMELD_POSTGRESQL`, a cache-disabled Hyperdrive binding
to PlanetScale PostgreSQL in the Amplift organization. Local product development
uses PostgreSQL 18. Space Durable Objects and local Service SQLite keep their
own storage; they are not part of the shared relational schema.

- Schema: `src/schema.ts`, `src/auth/*` and `src/core/*`.
- Native migrations and Drizzle journal: `postgresql/migrations`.
- Drizzle configuration: `postgresql/drizzle.config.ts`.
- Applied native history: `drizzle.__drizzle_migrations`.
- Immutable historical D1 migrations: [`drizzle/README.md`](drizzle/README.md).

Shared staging still runs its pre-cutover D1 deployment. The frozen production
D1 source is migration/recovery evidence, not a live writer or fallback. See
[physical database ownership](../../developing/architecture/physical-db-split.md)
and [logical ownership](../../developing/architecture/data-and-observability.md).

## Development and migrations

Use the [PostgreSQL workflow](../../developing/engineering/postgresql.md) for local
connection setup, generation, migration, acceptance, runtime grants and recovery.
Root `db:check`, `db:generate` and `db:studio` use the native PostgreSQL config.
Run local connection-dependent commands inside the documented isolated cluster.
`pnpm dev:postgresql` starts the complete local product with persistent worktree
data; `pnpm pg:local run <command>` creates a disposable PostgreSQL cluster.

Better Auth schema changes use the official generator:

```sh
pnpm --filter @openmeld/db auth:generate
```

The canonical generated file is `src/auth/auth.schema.ts`. Review generated
output, then generate and review the native migration. Generation needs no
runtime secrets and applies no migration. Do not hand-edit generated output.

Production migrations use the scoped release owner described in
[Production Database Release](../../developing/engineering/production-release.md#production-database-release).

## Implementation and validation

Use domain-owned repositories and native transactions. One transaction keeps
one client through commit or rollback. Preserve immutable applied migrations,
tenant authorization and diagnostic context; do not add runtime schema repair
or silent database fallback.

Choose focused checks for the changed behavior and its consumers. Use real
PostgreSQL when SQL semantics or persistence are at risk. Infrastructure changes
use `pnpm pg:check`; local product changes also need the affected real user path.
Follow the [development workflow](../../developing/engineering/development-workflow.md)
and the release owner for broader closeout gates.
