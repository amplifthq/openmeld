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

The separate setup and background check also retains its process ID, elapsed
startup time, output counts, and safe startup error text when it times out.
This distinguishes a failed check from a task that actually started.
