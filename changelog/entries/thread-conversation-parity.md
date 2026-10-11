---
id: thread-conversation-parity
title: Consistent conversations and Thread replies
kind: improved
areas: ["spaces", "threads", "center-agent"]
audiences: ["members", "admins"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["pr:1625", "commit:681e1c98df73a1ba5e7fb82a820902e72364ea04", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

Thread replies share Profile cards, message tools, quoted replies, queued
follow-ups, unread navigation, and Jump to latest with the main conversation.
Queued replies stay in their original conversation. The composer work shortcut
also finds queued replies in closed Threads and opens
the right Thread, alongside other work outside your view. Full-width messages
reserve room for avatars on both sides, so long messages have matching content
edges.
Members can open an existing Team Brief, while creation stays with owners and
admins.

Center Agent Profile cards show the model and a cloud icon, with a direct
settings action. Routine availability and default reasoning labels are omitted.
App Settings also omits the routine Available label.
Bot avatars in Profile cards look around, follow the mouse, and play a full
spin when clicked. Conversation avatars retain their small click hop.
