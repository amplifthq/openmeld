---
id: pending-agent-actions-stay-visible
title: Keep pending Agent actions within reach
kind: improved
areas: ["spaces", "agents"]
audiences: ["members"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Agent owners can handle pending permissions, questions, and plan reviews from a
quiet action surface above the currently visible Space or Thread composer, so
required input no longer gets buried in message history or behind an open Thread.

The action strip now sits against the composer and expands into a consistent
card for plans, questions, and permissions. Long details scroll within the card,
with subtle edge fades and response buttons that stay within reach.
