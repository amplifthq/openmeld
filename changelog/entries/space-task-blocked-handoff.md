---
id: space-task-blocked-handoff
title: Show blocked Task handoffs instead of silent success
kind: fixed
areas: ["spaces"]
audiences: ["members"]
---

A Task handoff now prepares a real Wake dispatch before publishing an activated
message. If the selected target is blocked, including when an Agent tries to
Wake itself, Task details retain the specific delivery failure and the Task
stays in its current phase. A published-looking message no longer hides work
that never started.
