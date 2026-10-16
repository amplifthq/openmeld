---
id: local-agent-early-reply
title: See Local Agent replies before cleanup finishes
kind: fixed
areas: ["spaces", "local-agents"]
audiences: ["users"]
---

Local Agents can show a submitted reply while their controller finishes cleanup.
Reply revisions update the same response. The response becomes final when the
turn finishes, so a slow Stop hook no longer hides a submitted reply.
