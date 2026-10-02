---
id: hosted-agent-prompt-caching
title: Enable prompt caching for supported hosted models
kind: fixed
areas: ["remote-agent", "center-agent"]
audiences: ["admins", "operators"]
publishedAt: 2026-10-01
release: v0.3.233
evidence: ["pr:1413", "commit:e4454cf165b96c7f918e420f28205c2b2ed3c575", "workflow:36830656160"]
---

Hosted Agents using Claude or supported Alibaba models can reuse identical
instructions, tool definitions, and conversation context through prompt caching,
reducing repeated input costs while keeping the selected model and full context.
Models with automatic caching keep their existing behavior. Savings depend on
provider cache hits.
