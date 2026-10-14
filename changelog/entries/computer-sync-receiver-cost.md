---
id: computer-sync-receiver-cost
title: Reduce Computer file preparation overhead
kind: improved
areas: ["computer"]
audiences: ["users"]
---

Computer file preparation uses fewer repeated checks and groups small object
writes into bounded transactions. Interrupted preparation still preserves saved
files and command results, and commands wait for confirmed file synchronization.
