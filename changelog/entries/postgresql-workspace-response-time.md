---
id: postgresql-workspace-response-time
title: More responsive workspace pages
kind: improved
areas: ["inbox", "spaces", "organizations", "accounts"]
audiences: ["users"]
publishedAt: 2026-10-05
evidence: ["pr:1513", "commit:d799f3f66b6465564f4a9f11709a16292541db2d", "workflow:37296182775", "workflow:37299205735"]
---

Inbox and Team pages do less repeated work when loading counts, agents, and computers. Live notifications avoid frequent empty requests while their connection is active. Refreshing the app keeps the current account photo while checking for its latest avatar.
