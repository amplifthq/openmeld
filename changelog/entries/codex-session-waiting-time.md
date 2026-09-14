---
id: codex-session-waiting-time
title: Clearer waiting and working time for local Agents
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

When another app is using an Agent's conversation, Spaces explains why the
request is waiting and offers Cancel waiting. Working time starts when execution
begins, excluding time spent waiting. Stopping a request after it starts no longer
reports that it was still waiting for the conversation.

Waiting requests can also recover after the other Codex process exits abruptly,
even if it leaves a lock file behind.
