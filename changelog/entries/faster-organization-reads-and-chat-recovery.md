---
id: faster-organization-reads-and-chat-recovery
title: Faster organization reads and clearer chat recovery
kind: improved
areas: ["spaces", "team", "inbox", "center-agent"]
audiences: ["members", "admins"]
---

Space member details and Inbox updates load with fewer sequential waits.
Activity, project, and usage reads do less database work. Team skips live
computer checks for members who have no registered computer.

Unavailable Center Agent chats now offer a fresh retry and a link to your own
chat. Short-lived live connections back off instead of repeatedly reconnecting
at the fastest rate.
