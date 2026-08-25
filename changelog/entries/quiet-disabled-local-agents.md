---
id: quiet-disabled-local-agents
title: Keep disabled local agents out of the way
kind: fixed
areas: ["computers", "local-agents"]
audiences: ["members"]
publishedAt: 2026-08-25
evidence: ["pr:238", "commit:b5261e72a3ef5752c246105a517b419b91fb1dc6", "workflow:32799908682"]
---

Local agents that you turn off now stay visually quiet and no longer create a
Computer alert. Installation choices also sit with the local agent's launch
details, and OpenMeld waits for the final result before calling a slow setting
change a failure.
