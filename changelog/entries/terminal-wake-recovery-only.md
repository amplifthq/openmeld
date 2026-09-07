---
id: terminal-wake-recovery-only
title: Start a new Wake from the composer
kind: removed
areas: ["spaces", "center-agent"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.158
evidence: ["pr:650", "pr:658", "commit:8b98ac0d0882e70a00f5f3eb6b7f818073a27254"]
---

Historical Wake failures no longer offer a shortcut that reruns the original
request. To run it again, send a new message from the Space composer. Message
details still provides diagnostics and recovery for an existing result when
available. The Center Agent no longer exposes the retired execution-retry tool.
