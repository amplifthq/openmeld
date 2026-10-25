---
id: codex-passive-conversation-checks
title: Check idle Codex conversations without resuming them
kind: fixed
areas: ["local-service", "codex"]
audiences: ["users", "operators"]
---

Background conversation checks read the stored Codex conversation summary
without resuming the conversation or initializing its tools. This avoids
repeated provider startup work while OpenMeld is idle. Actual Wake execution
still uses Codex's normal admission and resume checks.
