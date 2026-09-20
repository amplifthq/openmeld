---
id: target-scoped-agent-readiness
title: Check Agent readiness without waiting on unrelated Agents
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
---

Agent readiness checks use the selected Agent's current configuration and
computer report. Unrelated Agents with missing or stale working-folder reports
no longer block it. Space member status also reads fewer Profiles when a
computer has many Agents. Checks for the selected Agent's identity, computer,
configuration, and current Service session still apply.
