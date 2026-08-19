---
id: reliable-slack-onboarding
title: More reliable Slack onboarding
kind: fixed
areas: ["slack", "onboarding", "center-agent"]
audiences: ["admins", "members"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:84", "pr:142", "commit:54027f755ed43ff1d27055e06f8b15b3b43fa8eb", "workflow:32255551305", "workflow:32257426899"]
---

OpenMeld now keeps Slack setup and welcome delivery recoverable, avoids sending
the same welcome twice, respects the Organization's working language, and only
lets a verified member invite exact Slack teammates through Core-bound private
delivery.
