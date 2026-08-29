---
id: computer-details-wait-for-fresh-projection
title: Keep Computer details honest while they refresh
kind: fixed
areas: ["computers", "web"]
audiences: ["members"]
---

Opening a teammate's Computer now waits for a fresh Organization Computer
projection before deciding that the Computer no longer exists, so an older
cached list cannot briefly hide required update guidance.
