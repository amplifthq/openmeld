---
id: consistent-usage-brand-colors
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1529","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
title: Clearer AI usage charts
kind: fixed
areas: ["usage", "computers", "routines"]
audiences: ["users"]
---

Usage charts keep Claude orange and GPT blue-purple, matching their Local Agent
colors. Model variants stay within their brand's color family when you switch
between Organization and My agents, change the date range, or view a Computer.
Chart lines, legends, and tooltips use matching colors in light and dark themes.

The settings sidebar and page now use the name AI usage. Organization usage
shows the workspace total, while My agents includes both Remote Agent costs
and Local Agent tokens for your agents.

Routine counts move out of AI usage and appear beside the Routines page title
as a compact count, such as 3/50. Hover over or focus the count to see the limit.
