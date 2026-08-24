---
id: opencode-agent-answers-stay-content
title: Keep OpenCode answers separate from failures
kind: fixed
areas: ["agents", "cli"]
audiences: ["members", "admins"]
---

OpenMeld now uses OpenCode's structured result events to decide whether a local
Agent run succeeded or failed. Words such as "error," "invalid," or "rate
limit" inside an Agent's answer remain ordinary content and no longer stop the
run or turn the answer into a failure.
