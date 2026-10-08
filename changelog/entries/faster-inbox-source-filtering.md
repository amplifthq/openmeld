---
id: faster-inbox-source-filtering
title: Reduce Inbox loading work
kind: improved
areas: ["inbox"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Inbox performs less repeated work when loading larger notification histories.
Access checks, grouping, unread counts and pagination keep the same behavior.
