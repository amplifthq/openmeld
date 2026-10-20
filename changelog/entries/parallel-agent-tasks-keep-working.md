---
id: parallel-agent-tasks-keep-working
title: Keep parallel Agent tasks working after new tasks and Agent changes
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

A plain mention now continues your most recent task with that Agent in the
conversation instead of failing after you started a new task or forked one, and
it starts a new task when the Agent has moved to another computer or harness.
OpenMeld asks you to choose only while more than one of those tasks is still in
progress. An Agent switched from Codex or Claude Code to a harness without task
support works again with its usual one-at-a-time behavior. When another app is
using one task's conversation, only that task waits for your decision; the
Agent's other tasks keep running. A request waiting behind other work on your
computer now shows as waiting instead of working.
