---
id: keep-first-wakes-through-agent-preparation
title: Keep your first Wake while an Agent gets ready
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

You can send a Wake while a newly connected Agent's initial checks finish.
OpenMeld keeps the request and continues when the Agent is ready, without asking
you to send it again. Execution still requires valid access, Usage, and a working
folder; a request that cannot proceed ends with an explicit outcome.

If an accepted reply can no longer be safely published after the conversation
changes, OpenMeld now reports that outcome instead of leaving the Wake stuck
posting a reply. Reviewing another Agent's reply also preserves a request
addressed to each Agent, such as a direct ping.
