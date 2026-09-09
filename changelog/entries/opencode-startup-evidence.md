---
id: opencode-startup-evidence
title: Diagnose OpenCode startup failures more precisely
kind: improved
areas: ["agents", "service", "diagnostics"]
audiences: ["users", "developers"]
---

OpenCode startup failures retain evidence from both attempts, including whether
the local port could be reached and whether startup output arrived. Slow starts
also leave local diagnostic evidence before cleanup. These checks do not add a
step to normal Wakes or change task execution and retry limits.
