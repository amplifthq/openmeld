---
id: agent-task-recovery-and-local-time
title: More reliable task follow-up and local time
kind: fixed
areas: ["center-agent", "agents", "computer"]
audiences: ["users", "developers"]
---

Cloud Computer commands keep their recorded exit results when file synchronization
loses its connection. Slow command checks have a time limit, and one stuck check
no longer holds up the other commands. Agents can inspect the retained result
before deciding what to do next.

When a Space coordinator cannot finish because a retained Computer command was
lost, the Center Agent can make one restricted attempt to summarize the completed
Agents' published results. This does not restart their work or override Stop.

Web, Desktop, and Local Service share the same user time-zone record. Remote
Agents receive that time zone, the original request time, and a fresh current
time for each model request. Queued messages retain their original time context.
Local Agents are guided to use the user's local environment
unless the task calls for Cloud Computer.
