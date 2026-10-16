---
id: trace-retained-result-guidance
title: Find retained results after a Wake failure
kind: fixed
areas: ["cli", "spaces"]
audiences: ["users", "agents"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1718", "workflow:38595947657"]
---

The CLI trace summary now points to retained-result evidence when a result
arrives after a visible Wake failure. It keeps the original failure visible and
does not suggest starting the work again.
