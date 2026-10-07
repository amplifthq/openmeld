---
id: center-agent-settings-loading
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1528","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
title: Faster Center Agent settings
kind: improved
areas: ["center-agent", "settings"]
audiences: ["users"]
---

Center Agent settings load without waiting for every Agent in the workspace.
Model and organization memory settings load in parallel with identity, and
reopening settings keeps the previous values visible while they refresh.
