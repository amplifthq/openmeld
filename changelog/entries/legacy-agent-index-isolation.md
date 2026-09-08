---
id: legacy-agent-index-isolation
title: Keep older Agent activity from interrupting new Agent setup
kind: fixed
areas: ["agents", "runtime"]
audiences: ["users"]
---

Reading older Agent activity no longer repeatedly interrupts setup and working
folder changes for other Agents on the same account. Active execution checks
remain in place, and existing work is not stopped or discarded.
