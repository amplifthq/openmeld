---
id: staging-postgresql-alignment
title: Align staging with PostgreSQL production storage
kind: improved
areas: ["platform"]
audiences: ["contributors"]
---

The staging deployment uses its existing PostgreSQL database and isolated
Hyperdrive connection. It applies the same migration history as production
before deploying Auth and Core. The old staging D1 database remains available
for historical test-data inspection and is not a runtime fallback.
