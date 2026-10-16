---
id: computer-sync-receiver-cost
title: Reduce Computer file preparation overhead
kind: improved
areas: ["computer"]
audiences: ["users"]
publishedAt: 2026-10-14
evidence: ["pr:1708", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

Computer file preparation uses fewer repeated checks and groups small object
writes into bounded transactions. Interrupted preparation still preserves saved
files and command results, and commands wait for confirmed file synchronization.
