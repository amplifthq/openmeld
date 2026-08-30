---
id: honest-wake-queue-progress
title: Show why a Wake is waiting
kind: fixed
areas: ["spaces", "agents", "wake"]
audiences: ["members"]
---

Space now says a Wake is queued only when another Wake is already using that
Agent Profile. Ordinary delivery setup stays a neutral sent request instead of
claiming that the Agent is waiting in a task queue.
