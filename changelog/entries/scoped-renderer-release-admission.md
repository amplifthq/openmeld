---
id: scoped-renderer-release-admission
title: Keep renderer releases within their selected scope
kind: fixed
areas: ["release", "developer-workflow"]
audiences: ["operators", "contributors"]
---

Website-only and Docs-only releases no longer require product database
inspection credentials. Nested builds can reserve their actual memory budget
without manually configuring an outer wrapper, provided current capacity and
memory pressure allow it.
