---
id: recover-center-agent-wake-results
title: Keep Center Agent Wakes from getting stuck
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

Center Agent Wakes now safely resume the same saved request when worker
admission is interrupted or its outcome is unclear, without starting a second
turn. OpenMeld also keeps a finished answer with its terminal execution state,
so a restart can still deliver one reply instead of leaving the conversation
waiting forever.
