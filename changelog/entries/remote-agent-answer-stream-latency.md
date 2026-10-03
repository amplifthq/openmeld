---
id: remote-agent-answer-stream-latency
title: See Remote Agent answers sooner
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

Short Remote Agent answers now start appearing as soon as their text is ready.
The rest of each answer appears when the model finishes its message, without
waiting for conversation history to be summarized. The Agent remains working
until its task has finished, and Stop still prevents further answer updates.
