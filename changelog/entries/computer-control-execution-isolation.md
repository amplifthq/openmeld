---
id: computer-control-execution-isolation
title: Keep Computer controls independent of Agent execution
kind: improved
areas: ["computers", "local-agents"]
audiences: ["users"]
---

Computer connectivity and local Agent execution now run in separate processes,
so an execution-host failure does not freeze the connection's control loop.
Reconnecting retains the same local work and saved results instead of creating
a second execution owner. Stopping and updating still wait for evidence that
local work is safely finished; uncertain work remains a visible recovery blocker.
This change does not add offline Disconnect or change account-switch consent.

Codex requests use its supported human-approval settings without dropping the
Computer file-access boundary. Explicitly declining a file-access exception
stops the task and explains the decision in the Space instead of reporting a
provider failure. Connecting the first Project also starts the existing Activity
observer setup without requiring a Service restart.
