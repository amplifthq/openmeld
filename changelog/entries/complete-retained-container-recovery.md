---
id: complete-retained-container-recovery
title: Finish interrupted Remote Agent Container releases
kind: fixed
areas: ["engineering", "remote-agent"]
audiences: ["contributors"]
publishedAt: 2026-10-14
evidence: ["pr:1720", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

Recovery after a Worker-only release can record completion once the Worker
and Container pass verification. It preserves the original release attempt
and retained Container evidence. Failed recovery remains unresolved instead
of losing its failure record.
