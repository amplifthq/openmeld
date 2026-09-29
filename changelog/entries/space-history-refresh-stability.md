---
id: space-history-refresh-stability
title: Keep conversations stable when Agent details refresh
kind: fixed
areas: ["spaces", "web", "desktop"]
audiences: ["users"]
---

Fixes a page crash that could occur when opening a Space while Agent details on
existing messages refresh. The conversation and its saved history now retain
the same updated message details.
Error reports also retain bounded update-path diagnostics to help locate
future conversation update loops.
