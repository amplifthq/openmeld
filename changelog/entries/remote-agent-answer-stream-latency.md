---
id: remote-agent-answer-stream-latency
title: Keep live answers stopped when you press Stop
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

Remote Agent answers still appear as soon as their text is ready. Pressing Stop
also prevents a late model message from revealing more buffered answer text.
Failed or interrupted model messages no longer flush unfinished text before a retry.
