---
id: hosted-agent-command-loss-completes
title: Show an outcome when a Hosted Agent command disappears
kind: fixed
areas: ["center-agent", "remote-agent", "computer", "spaces"]
audiences: ["members", "operators"]
---

When a Hosted Agent's Computer confirms that a command is gone during cleanup,
the request ends with a visible failure instead of staying in progress. It does
not run the command again, so completed work is not repeated.
