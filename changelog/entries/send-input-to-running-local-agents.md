---
id: send-input-to-running-local-agents
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1540","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","workflow:37512193993","dispatch:8e50474d-da2c-4d3d-9a60-15e57e952212"]
title: Send extra instructions while Claude Code is working
kind: improved
areas: ["agents", "spaces", "openmeld-service"]
audiences: ["users"]
---

Claude Code can receive queued instructions during a running task through the
same Send now action as Codex. OpenMeld waits for Claude to confirm receipt
before showing the message as sent. This requires Claude Code 2.1.290 or later.

Replies no longer show an outdated-message notice for instructions confirmed
as delivered to that same running task. Local agent capability reports also
reflect the approval and question flows already supported by their adapters.
