---
id: organization-agent-readiness-batch-reads
title: Reduce repeated reads when loading organization Agent status
kind: improved
areas: ["web", "agents"]
audiences: ["users", "admins"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

Organization Agent status uses batched identity and database reads to reduce
backend round trips for larger teams. Agent ownership, Binding conflicts,
organization eligibility, and Wake availability checks remain in place.
Unavailable evidence continues to produce an unavailable result.
