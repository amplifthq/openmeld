---
id: recover-accepted-agent-creation
title: Keep Agent creation trackable when setup takes longer
kind: fixed
areas: ["agents", "web", "cli"]
audiences: ["users", "developers"]
publishedAt: 2026-09-09
release: v0.3.183
evidence: ["pr:806", "pr:807", "workflow:34309494499", "dispatch:93c0d43d-a88a-45a1-bc51-9c0cc840d378", "dispatch:a0f658d7-f9da-4fcb-8bb0-c29d1fd54eec"]
---

Agent creation now returns a trackable request while setup continues on the
server. A lost response can recover the same request, and an uncertain result
no longer tells you that creation failed. Repeating the same intent preserves
the original Agent, including when its remaining setup needs attention.
