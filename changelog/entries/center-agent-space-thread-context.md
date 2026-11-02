---
id: center-agent-space-thread-context
title: Keep Space rules and earlier decisions available from a thread
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

When the Center Agent is woken inside a thread, it can read the rest of that
Space before answering, and it says when the history is incomplete. A standing
rule confirmed in the Space is saved to the Space guide and followed on later
turns, instead of being left only in chat.
