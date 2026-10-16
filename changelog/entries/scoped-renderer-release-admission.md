---
id: scoped-renderer-release-admission
title: Keep renderer releases within their selected scope
kind: fixed
areas: ["release", "developer-workflow"]
audiences: ["operators", "contributors"]
publishedAt: 2026-10-15
release: v0.3.262
evidence: ["workflow:38675991212", "workflow:38675995265"]
---

Website-only and Docs-only releases no longer require product database
inspection credentials. Nested builds can reserve their actual memory budget
without manually configuring an outer wrapper, provided current capacity and
memory pressure allow it.
