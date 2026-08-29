---
id: computer-details-wait-for-fresh-projection
title: Keep Computer details honest while they refresh
kind: fixed
areas: ["computers", "web"]
audiences: ["members"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:468", "commit:12a2549214c12e884c6f42fd501dbf573e2333b4", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:acb7e69e-ffed-4ef2-96e7-c734a2598961", "worker-version:c3c4d138-2fd2-4df6-9ef2-d49fb24cf085", "pr-comment:5463688488"]
---

Opening a teammate's Computer now waits for a fresh Organization Computer
projection before deciding that the Computer no longer exists, so an older
cached list cannot briefly hide required update guidance.
