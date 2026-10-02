---
id: routine-admission-and-callback-recovery
title: More reliable Routine delivery
kind: fixed
areas: ["routines", "remote-agents"]
audiences: ["members", "admins"]
evidence: ["pr:1198"]
---

Routines keep recovering when an Agent's acknowledgement is missing instead of
silently waiting for an unconfirmed execution. Long-running Routines can still
receive their result after a callback wait expires, without starting the Agent
again.
