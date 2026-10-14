---
id: historical-release-billing-config-check
title: Validate configuration against the release being recovered
kind: fixed
areas: ["platform"]
audiences: ["admins"]
---

Recovery checks accept the former internal billing setting only when the pinned
release still reads it. Current releases continue to reject that removed setting.
This lets an interrupted release resume without changing its source or bypassing
configuration checks.
