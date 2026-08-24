---
id: keep-local-agent-permissions-stable-during-repair
title: Keep local agent permissions stable during repair
kind: fixed
areas: ["agent-profiles", "service"]
audiences: ["members"]
---

Repair work no longer leaves supported local agents with a different permission
mode or conversation. Claude Code and OpenCode isolate temporary repair work,
while Cursor and Grok Build keep the permission mode you selected for the next
normal task.
