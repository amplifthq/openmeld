---
id: computer-admission-refresh-recovery
title: Keep local Agent Wakes available through refreshes and startup
kind: fixed
areas: ["computers", "service", "wake"]
audiences: ["users"]
---

OpenMeld Service now reports a Computer's current availability as soon as a local Agent catalog refresh finishes. Wakes no longer wait for the next heartbeat after the Computer is ready again. Codex Wakes now use a compatible local tool runtime and report setup failures with a Diagnostics next step.
