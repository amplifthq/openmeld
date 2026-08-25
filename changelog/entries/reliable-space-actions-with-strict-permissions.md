---
id: reliable-space-actions-with-strict-permissions
title: Let Agents reply without a shell approval prompt
kind: fixed
areas: ["spaces", "agent-profiles", "local-agents"]
audiences: ["members", "agents"]
---

Agents can now choose and record a Space reply, final status, or silent outcome
through a dispatch-scoped OpenMeld tool without asking the member to approve an
OpenMeld shell command. This does not relax the Agent Profile's normal Codex
permissions. Multi-paragraph replies also preserve real line breaks, literal
`\n` text, quotes, backslashes, emoji, and shell-like characters without
rewriting the message. The dispatch-scoped CLI remains available as a fallback
and for replies with attachments.
