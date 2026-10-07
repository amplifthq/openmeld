---
id: space-inbox-read-efficiency
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1561", "pr:1568", "worker-version:74100b9e-a3cd-4ddb-81e1-65e823b44fc1", "worker-version:5b8476d9-feaf-4b8c-88a5-d5d8c5b7a30d"]
title: More reliable Space return visits and lighter Inbox reads
kind: improved
areas: ["spaces", "inbox"]
audiences: ["users"]
---

Spaces keep their recovered message position when you leave and return, avoiding
repeated catch-up failures. Opening a Space combines its access and membership
reads. Inbox reuses current Agent ownership checks within each feed request,
reducing repeated database work while keeping permissions, counts, and bulk
actions consistent.
