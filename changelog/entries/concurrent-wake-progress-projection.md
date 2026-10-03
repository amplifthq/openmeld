---
id: concurrent-wake-progress-projection
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1469","workflow:37111856220"]
title: Preserve Wake progress during concurrent updates
kind: fixed
areas: ["wake", "diagnostics"]
audiences: ["users", "operators"]
---

Wake progress and diagnostic records retain newer execution evidence when
accepted lifecycle updates arrive together. Concurrent first writes also
converge on one record, while published replies, terminal failures, and
cancelled outcomes keep their existing protection against conflicting updates.
