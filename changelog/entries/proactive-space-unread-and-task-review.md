---
id: proactive-space-unread-and-task-review
title: Keep proactive reports and Task reviews visible
kind: fixed
areas: ["spaces", "inbox", "tasks"]
audiences: ["members"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:ed3187da98d1ca78d715c23afafddf0cb21dbec6", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

Proactive Agent reports, Routine results, and formal system outcomes now create
unread updates for the conversation's recipients. Reading a message before Inbox
finishes syncing keeps it read after synchronization.

Space Tasks awaiting a Human review or rework decision now remain in Inbox until
the Task's own workflow ends the request. Reading messages or dismissing an Inbox
item does not approve the result.
