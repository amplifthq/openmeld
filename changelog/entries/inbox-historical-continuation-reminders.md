---
id: inbox-historical-continuation-reminders
title: Open and clear older task reminders
publishedAt: 2026-10-02
release: v0.3.236
evidence: ["pr:1442","commit:7eba5b84b75cd655b508a8f3cf5959281a11eab3","workflow:37023562187","workflow:37025217534"]
kind: fixed
areas: ["inbox", "spaces"]
audiences: ["members"]
---

Older task-continuation reminders open the originating conversation without
linking to a message from another Space or suggesting an unavailable retry.
Removing a reminder from Inbox clears its unread and attention counts while
leaving the task unchanged. Missing message links show the conversation's latest
messages with a clear explanation instead of an internal error.
