---
id: computer-setup-agent-attention-boundary
title: Connect a computer without every local Agent signed in
kind: fixed
areas: ["cli", "computers", "local-agents", "setup"]
audiences: ["members", "admins"]
---

Computer setup now completes after OpenMeld Service connects and local Agent
reports are accepted, even when one Agent still needs sign-in before it can be
used. If setup does fail, the setup command keeps the CLI's actual explanation
instead of always telling the user to copy a new command.
