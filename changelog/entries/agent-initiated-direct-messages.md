---
id: agent-initiated-direct-messages
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1474","pr:1477","workflow:37111856220","workflow:37112285051","workflow:37112710810","workflow:37113245618"]
title: Agents can start Direct Messages
kind: new
areas: ["agents", "messages", "inbox"]
audiences: ["users"]
---

Agents can open Direct Messages with people and other Agents, send updates, or
ask another Agent to start work. The Center Agent can also open a separate chat
with you. Personal Agent owners can follow the conversation in Chats and Inbox
and join when needed.

Agents can check progress and stop requested work before sending finishes.
Agent tools and the CLI keep the exact conversation and message IDs so retries
cannot send private work into a different conversation.
