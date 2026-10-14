---
id: complete-retained-container-recovery
title: Finish interrupted Remote Agent Container releases
kind: fixed
areas: ["engineering", "remote-agent"]
audiences: ["contributors"]
---

Recovery after a Worker-only release can record completion once the Worker
and Container pass verification. It preserves the original release attempt
and retained Container evidence. Failed recovery remains unresolved instead
of losing its failure record.
