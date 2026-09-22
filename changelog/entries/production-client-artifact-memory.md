---
id: production-client-artifact-memory
title: Reliable memory budgets for production client checks
kind: fixed
areas: ["releases"]
audiences: ["contributors", "operators"]
evidence: ["pr:1232"]
---

Production release checks and the manual client artifact check now use the same
memory budget for Web and Desktop builds. They reserve build capacity before
starting, preserve system headroom, and report the runner's effective memory.
Unconstrained Linux processes no longer inflate the machine's reported capacity.
