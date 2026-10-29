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

The Center Agent can also reread one Task's current result, review, and delivery
status, so it can report the recorded blocker instead of guessing from an earlier
creation or assignment confirmation.
