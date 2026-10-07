---
id: opencode2-antigravity-acp
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1540","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","workflow:37512193993","dispatch:8e50474d-da2c-4d3d-9a60-15e57e952212"]
title: Connect OpenCode 2 and Antigravity ACP
kind: new
areas: ["agents", "openmeld-service"]
audiences: ["users"]
---

Local agents can use OpenCode 2 or the official Antigravity ACP installation.
Both support continued conversations, native tools, permission requests, and
questions through the existing OpenMeld controls. Existing OpenCode 1 and
Antigravity CLI installations remain supported.

Antigravity status checks do not start sign-in. A connected provider account is
still required to run its models. Automatic reply repair remains unavailable
for these two new transports until their tool restrictions can be verified.
