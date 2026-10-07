---
id: files-routines-local-skeletons
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1568", "commit:bc90c55ef435b3dcbe3e8b2d5d455a11df46680a", "worker-version:74100b9e-a3cd-4ddb-81e1-65e823b44fc1"]
title: Quieter loading in Files and Routines
kind: improved
areas: ["web"]
audiences: ["users"]
---

Files and Routines show simple skeletons where content is loading, keeping
navigation and available toolbar actions usable. Files no longer switches
between repeated loading messages, and background refreshes keep existing
files visible.
