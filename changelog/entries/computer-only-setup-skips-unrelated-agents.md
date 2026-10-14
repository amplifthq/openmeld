---
id: computer-only-setup-skips-unrelated-agents
title: Connect your computer without preparing unrelated agents
kind: fixed
areas: ["desktop", "cli", "computers"]
audiences: ["users"]
---

Desktop Connect and CLI setup with `--local-agents none` no longer wait for
unrelated local agents to be checked or repaired. Account and Service checks
still run. Background agent discovery continues after connection.
