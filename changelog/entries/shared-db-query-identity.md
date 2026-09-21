---
id: shared-db-query-identity
title: Keep Auth queries compatible with shared database types
kind: fixed
areas: ["auth", "database", "developer-experience"]
audiences: ["contributors"]
---

Auth repositories now use query operators and inferred-record types from the
same Drizzle instance as OpenMeld's shared tables. Type checks no longer mix
incompatible instances when optional SQLite dependencies resolve differently.

The shared `@openmeld/db/query` entrypoint preserves existing queries, account
authorization, database schemas, and the SQLite 13 runtime and installation
fixes. No database migration or dependency version override is required.
