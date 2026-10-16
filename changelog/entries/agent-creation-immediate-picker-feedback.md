---
id: agent-creation-immediate-picker-feedback
title: See new Agents in the member picker immediately
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["commit:682d4fd273675b9dc405456a2c46a68aa24d8f4d", "commit:e7bcf2f444662ce4acc618d32354e378ce8df3fc"]
---

New Local and Remote Agents appear checked at the top of their owner's list
while creation finishes. Clearing the selection stays respected when the Agent
is ready. Failed creations no longer block adding other members. After Grok Bot
sign-in, Agent creation updates in the same dialog.
The Service collects new connection evidence after setup instead of reusing a
check that started before sign-in finished.
