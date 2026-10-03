---
id: immediate-agent-stop
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1476","pr:1477","workflow:37111856220","workflow:37112285051","workflow:37112710810","workflow:37113245618"]
title: Stop an Agent as soon as you send
kind: improved
areas: ["spaces", "center-agent", "local-agents", "cli"]
audiences: ["users", "integrators"]
---

Stop is available from the first optimistic message, including new-chat
preparation. A single click shows Stopping immediately, keeps the partial
answer, and waits for confirmation before showing Stopped. Unconfirmed stops
remain retryable when the connection fails.

Conversation progress uses Thinking instead of exposing internal Wake and
connection steps, while useful tool activity, waiting, and approval states
remain visible. CLI and personal Remote Agents can stop the same exact request
before its first progress snapshot exists.
