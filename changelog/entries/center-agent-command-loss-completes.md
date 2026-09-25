---
id: center-agent-command-loss-completes
title: Show an outcome when a Center Agent command disappears
kind: fixed
areas: ["center-agent", "computer", "spaces"]
audiences: ["members", "operators"]
---

If a Center Agent Computer command disappears during cleanup, the request now
ends with a visible failure instead of remaining in progress indefinitely. The
command is not run again, so any work it may have completed is not repeated.
