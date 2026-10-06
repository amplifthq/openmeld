---
id: hosted-agent-context-recovery
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1535","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","pr:1554","commit:0b048940e491d46ab4a03d7317b4259b1176ef26","worker-version:59b1b4ec-4357-41aa-a156-ec9bd1aab1bc"]
title: Keep hosted agents on track after context compaction
kind: improved
areas: ["center-agent", "remote-agents"]
audiences: ["members"]
---

Center Agents and hosted Remote Agents can recover their most recently selected
tools and available retained results after a conversation is shortened. Context
compaction reserves room for new work and uses one summary request per working
checkpoint. Computer tasks keep their existing identity for progress checks,
result retrieval, and cancellation.
