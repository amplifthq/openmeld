---
id: historical-release-billing-config-check
title: Validate configuration against the release being recovered
kind: fixed
areas: ["platform"]
audiences: ["admins"]
publishedAt: 2026-10-14
evidence: ["pr:1730", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

Recovery checks accept the former internal billing setting only when the pinned
release still reads it. Current releases continue to reject that removed setting.
This lets an interrupted release resume without changing its source or bypassing
configuration checks.
