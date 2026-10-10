---
id: staging-postgresql-alignment
title: Align staging with PostgreSQL production storage
kind: improved
areas: ["platform"]
audiences: ["contributors"]
publishedAt: 2026-10-08
evidence: ["pr:1604","commit:dde6988f39922ca1d4528b212eb390926a2123db","deployment:openmeld-auth-stg/c1e25da0-0e8c-45bd-9ad1-99b0472765ef","deployment:openmeld-core-stg/db4612d7-932f-49ca-8c18-75b591832698"]
---

The staging deployment uses its existing PostgreSQL database and isolated
Hyperdrive connection. It applies the same migration history as production
before deploying Auth and Core. The old staging D1 database remains available
for historical test-data inspection and is not a runtime fallback.
