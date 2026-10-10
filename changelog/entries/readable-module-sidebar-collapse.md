---
id: readable-module-sidebar-collapse
title: Keep sidebar lists readable while resizing
kind: fixed
areas: ["navigation", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:0a3b9d9227385fb070912224fe314c1e4f73099f", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

Contextual sidebar lists stay at their minimum readable width while you drag
inward. The minimum width is more compact. Collapse requires another third of
that width plus a small buffer, which prevents small drag movements from hiding
the list. A shorter outward drag reopens it. Dragging and keyboard resizing no
longer leave a squeezed icon-only state. Longer names stay on one line with an
ellipsis, and edge hover still reveals a temporary preview.
