---
id: recover-accepted-agent-creation
title: Keep Agent creation trackable when setup takes longer
kind: fixed
areas: ["agents", "web", "cli"]
audiences: ["users", "developers"]
---

Agent creation now returns a trackable request while setup continues on the
server. A lost response can recover the same request, and an uncertain result
no longer tells you that creation failed. Repeating the same intent preserves
the original Agent, including when its remaining setup needs attention.
