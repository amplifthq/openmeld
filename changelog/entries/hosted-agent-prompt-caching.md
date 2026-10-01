---
id: hosted-agent-prompt-caching
title: Enable prompt caching for supported hosted models
kind: fixed
areas: ["remote-agent", "center-agent"]
audiences: ["admins", "operators"]
---

Hosted Agents using Claude or supported Alibaba models can reuse identical
instructions, tool definitions, and conversation context through prompt caching,
reducing repeated input costs while keeping the selected model and full context.
Models with automatic caching keep their existing behavior. Savings depend on
provider cache hits.
