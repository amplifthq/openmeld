---
id: bounded-agent-working-context
title: More predictable costs in long agent conversations
kind: improved
areas: ["center-agent", "remote-agent"]
audiences: ["members", "admins"]
---

Long conversations now check the active context before each model call and
summarize older messages when needed. Agents can look up original messages
omitted from the summary while you continue in the same conversation.

Summarizing an existing long conversation has a one-time cost. Later calls use
a bounded working context, with additional history retrieved when the task
needs it. Incomplete summaries do not replace the existing context.
