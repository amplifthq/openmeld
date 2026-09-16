---
id: spaces-bounded-background-loading
title: Open Spaces with less background loading
kind: improved
areas: ["spaces", "web"]
audiences: ["users"]
---

Spaces skip history recovery for Wakes whose targets already have recorded outcomes,
limit concurrent recovery requests, and cancel that work when you leave the Space.
Unresolved targets still recover through the existing server checks.

Graph and Files load when opened, and Files image previews download as they approach
the visible area. Space member snapshots share database reads within each request,
and versioned Web assets can be reused from the browser cache.
