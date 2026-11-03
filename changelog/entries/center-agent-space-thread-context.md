---
id: center-agent-space-thread-context
title: Read earlier Space decisions from a thread
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

When the Center Agent is woken inside a thread, it can read the rest of that
Space before answering, including the main conversation and other threads. If
the answer is still missing, it continues the same read with a higher limit
instead of stopping at the first page, and it says when the history is incomplete.
