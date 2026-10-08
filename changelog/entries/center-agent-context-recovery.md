---
id: center-agent-context-recovery
title: Keep Center Agent tasks running through recoverable errors
kind: fixed
areas: ["center-agent"]
audiences: ["members"]
evidence: ["pr:1590"]
---

Center Agent preserves your active instructions when it summarizes a long task.
Temporary summary errors can recover without repeating completed operations.
Computer, browser, and document resources are prepared when needed, so an unused
resource does not prevent a task from starting.
If a response reaches the model's output limit, Center Agent can try to produce
a shorter, complete answer. An unfinished response is not reported as complete.
