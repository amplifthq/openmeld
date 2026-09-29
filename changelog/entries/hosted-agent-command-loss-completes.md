---
id: hosted-agent-command-loss-completes
title: Show an outcome when a Hosted Agent command is lost
kind: fixed
areas: ["center-agent", "remote-agent", "computer", "spaces"]
audiences: ["members", "operators"]
---

When a Hosted Agent's Computer confirms during cleanup that a command is gone or
its container runtime was replaced, the request ends with a visible failure
instead of staying in progress. OpenMeld does not rerun the command, so work
with unknown external effects is not repeated.
If someone already selected Stop, OpenMeld confirms the request and shows the
stopped outcome after cleanup settles.
