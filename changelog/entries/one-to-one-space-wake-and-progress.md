---
id: one-to-one-space-wake-and-progress
title: Talk directly to the only Agent in a Space
kind: improved
areas: ["spaces", "agents"]
audiences: ["users"]
publishedAt: 2026-10-03
release: v0.3.240
evidence: ["pr:1487", "commit:15549cc047d90f90edfbe2a1209919681a1e7e24", "commit:a76ffd7eb654e78ad0be127cea8deb944c18d10f", "commit:5f5ec1d00ab8dc7f6d7bf8e00a912cd03a93abb2", "workflow:37138463357"]
---

In a Space with one person and one Agent, messages can reach the Agent without
an @mention. Adding another member restores explicit addressing; one-person,
one-Agent Threads keep their independent automatic addressing.

Working status stays visible while a Center Agent chooses where to reply.
Thinking updates no longer create an empty Thread before an answer appears in
the main conversation.

Center and Remote Agents can choose main or Thread to match your instructions
and the task, and change that choice before final publication. Live work and
the reply draft follow the current choice together.

Replies show live work and elapsed time in the conversation. Short answers
appear as soon as they arrive, without waiting for conversation compaction.
