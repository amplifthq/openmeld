---
id: claude-space-reply-repair-plan-review
title: Keep Claude reply delivery from waiting for plan approval
kind: fixed
areas: ["agents", "spaces", "service"]
audiences: ["users"]
publishedAt: 2026-11-03
release: v0.3.290
evidence: ["pr:362", "workflow:41601722765", "tag:v0.3.290"]
---

When OpenMeld asks Claude to finish delivering or repair a Space reply, it
can continue that work without opening a new plan approval prompt. Ordinary
Claude execution turns still support plan review.
