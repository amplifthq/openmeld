---
id: readable-module-sidebar-collapse
title: Keep sidebar lists readable while resizing
kind: fixed
areas: ["navigation", "spaces"]
audiences: ["users"]
---

Contextual sidebar lists stay at their minimum readable width while you drag
inward. The minimum width is more compact. Collapse requires another third of
that width plus a small buffer, which prevents small drag movements from hiding
the list. A shorter outward drag reopens it. Dragging and keyboard resizing no
longer leave a squeezed icon-only state. Longer names stay on one line with an
ellipsis, and edge hover still reveals a temporary preview.
