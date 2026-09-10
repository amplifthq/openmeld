---
id: organization-agent-readiness-batch-reads
title: Reduce repeated reads when loading organization Agent status
kind: improved
areas: ["web", "agents"]
audiences: ["users", "admins"]
---

Organization Agent status uses batched identity and database reads to reduce
backend round trips for larger teams. Agent ownership, Binding conflicts,
organization eligibility, and Wake availability checks remain in place.
Unavailable evidence continues to produce an unavailable result.
