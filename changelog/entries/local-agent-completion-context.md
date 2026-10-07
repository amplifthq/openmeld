---
id: local-agent-completion-context
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1542","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","workflow:37512193993","dispatch:8e50474d-da2c-4d3d-9a60-15e57e952212"]
title: Reduce repeated context in local Agent conversations
kind: improved
areas: ["agents"]
audiences: ["users"]
---

Local Agents with verified native instruction delivery receive fewer repeated
completion rules on each Wake. The current request, permitted actions, and
task facts remain in every turn. Existing conversations without matching
instruction evidence keep the complete prompt.

Local Agents can also search large Space tool results for exact text and read
the surrounding original content. Complete results remain available through
paging, and every read checks source access and version again.
