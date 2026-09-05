---
id: wake-status-orbs-and-response-feedback
title: Clearer Agent progress and response feedback
kind: improved
areas: ["spaces", "agents", "web"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.158
evidence: ["pr:652", "pr:658", "commit:8b98ac0d0882e70a00f5f3eb6b7f818073a27254"]
---

Agent progress uses consistent status orbs for connecting, waiting, working,
replying, and requests that need your response. Space sidebar indicators give
requests needing your input priority over ongoing work.

Progress stays next to the message, above its actions. Pending requests remain
above the Composer, and sending a response no longer implies that the Agent
has already resumed. Plan reviews render formatted Markdown.
