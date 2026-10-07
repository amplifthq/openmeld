---
id: stable-space-thread-work-status
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1531","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
title: Keep Agent progress steady across Space and Thread views
kind: fixed
areas: ["spaces", "agents", "web"]
audiences: ["users"]
---

Agent progress and available Stop controls stay visible when you jump to a
message or open its Thread. Active requests use one Working status instead of
switching between similar labels. Known live work remains visible while Thread
history loads, and messages load independently of progress updates.
