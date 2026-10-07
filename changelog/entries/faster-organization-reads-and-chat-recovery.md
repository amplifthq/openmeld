---
id: faster-organization-reads-and-chat-recovery
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1534","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
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
