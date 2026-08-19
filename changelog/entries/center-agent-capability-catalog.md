---
id: center-agent-capability-catalog
title: Help the Center Agent find the right capability
kind: improved
areas: ["center-agent", "channels", "slack"]
audiences: ["members"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:142", "commit:54027f755ed43ff1d27055e06f8b15b3b43fa8eb", "workflow:32255551305", "workflow:32257426899"]
---

The Center Agent now loads a small set of tools relevant to each request and
searches the same organized catalog before treating a hidden tool as missing.
This also lets a verified member ask from any current Slack conversation to
privately invite named teammates, while exact directory matching and Core
authorization keep every invitation scoped to the requested people.
