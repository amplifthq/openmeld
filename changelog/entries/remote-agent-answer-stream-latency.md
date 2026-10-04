---
id: remote-agent-answer-stream-latency
title: Keep stopped replies clear and readable
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

Remote Agent answers still appear as soon as their text is ready. Pressing Stop
also prevents a late model message from revealing more buffered answer text.
Failed or interrupted model messages no longer flush unfinished text before a retry.

Stopped replies now show `Stopped` with the corresponding Agent and request,
instead of a separate notice across the conversation. Any public reply text
already shown stays readable after stopping and refreshing the page.
