---
id: current-development-and-release-guidance
title: Align development and release guidance with PostgreSQL
kind: fixed
areas: ["development", "release"]
audiences: ["contributors", "operators"]
evidence: ["pr:1558"]
---

Default development commands start the isolated PostgreSQL product stack.
Desktop pilot builds use the shared renderer memory budget and resource checks.
Hosted releases reject unsupported PostgreSQL scopes before preparing artifacts.
Release status preserves known deployment history when impact analysis or
receipt verification remains unresolved.
