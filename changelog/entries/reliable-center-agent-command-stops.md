---
id: reliable-center-agent-command-stops
title: Stop Center Agent commands and continue chatting
kind: fixed
areas: ["center-agent", "computer", "spaces", "diagnostics"]
audiences: ["members", "operators"]
---

Stopping a Center Agent request now stops its long-running Computer commands
without stopping commands from another chat. The stopped outcome replaces
temporary progress or failure messages, and you can continue the conversation
afterward.

Temporary callback failures retry until the outcome can be delivered. Stopped
requests remain available in diagnostics instead of appearing to be missing.

When a Computer runtime is replaced, the Agent receives an explicit command
loss and can inspect saved files before continuing. Lost commands are not
silently relaunched, and cleanup does not turn recovered work into a failure.
