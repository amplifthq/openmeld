---
id: recover-center-agent-wake-results
title: Keep Center Agent Wakes from getting stuck
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

Center Agent Wakes now keep a finished answer with the terminal execution
state, so a restart can still deliver one reply instead of leaving the
conversation waiting forever or publishing a stale result.
