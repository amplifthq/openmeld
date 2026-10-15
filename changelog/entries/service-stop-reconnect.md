---
id: service-stop-reconnect
title: Recover the connection while stopping OpenMeld Service
kind: fixed
areas: ["computer", "local-service"]
audiences: ["users"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1727", "workflow:38595947657"]
---

If the connection drops while OpenMeld Service is finishing accepted work,
it reconnects and continues the same stop request. Pending replies remain saved,
and any required reply review continues in the original task. Reconnecting does
not restart that task.
