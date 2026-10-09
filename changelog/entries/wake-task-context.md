---
id: wake-task-context
title: Understand a Wake's task access and start fresh
kind: improved
areas: ["spaces", "agents", "cli"]
audiences: ["members", "operators"]
---

Message details explains a Wake's task access, working-folder selection, and
whether its Agent conversation started fresh or continued. A Space-only task
lets its original requester review and send the request as a new task using
the Agent's current permitted settings. Reopening or retrying the same recovery
does not create another task.

The Agent's Session options clarify that automatic continuation keeps earlier
restrictions.
CLI diagnostics can read retained task settings after the transient execution
record has retired, while older trace clients keep their existing response.
