---
id: recover-missing-local-agent-space-actions
title: Recover a Local Agent reply without interrupting the member
kind: fixed
areas: ["spaces", "local-agents", "agent-profiles"]
audiences: ["members", "agents"]
---

When a Local Agent finishes its work but forgets to send the result back to the
Space, OpenMeld now gives the same private Agent conversation one concise
reminder to record the reply, status, or silent outcome. The Agent does not redo
the work, and the member is not asked to approve an OpenMeld shell command.

OpenMeld also restores its official Local Agent guidance when the managed copy
is missing or outdated, while leaving user-owned files and stricter custom tool
policies untouched. Codex, Claude Code, Cursor, Grok Build, OpenCode, and
OpenClaw use the same protected Space Action boundary, and the OpenMeld CLI
remains available when an Agent needs it.
