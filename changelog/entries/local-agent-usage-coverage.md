---
id: local-agent-usage-coverage
title: More complete local agent usage
kind: improved
areas: ["computers", "local-agents"]
audiences: ["users"]
publishedAt: 2026-10-01
release: v0.3.233
evidence: ["pr:1412", "commit:e4454cf165b96c7f918e420f28205c2b2ed3c575", "workflow:36831389174"]
---

Computers can show usage from supported Claude Code accounts, Cursor CLI logins,
and OpenRouter accounts connected through OpenCode. Grok Build correctly shows
unused capacity when its billing response omits a zero value. Missing usage now
distinguishes sign-in requirements, unsupported account capabilities, unreported
limits, and failed refreshes.

Usage availability still depends on the account and provider. Observational
sources show capacity without preventing otherwise ready agents from starting.
