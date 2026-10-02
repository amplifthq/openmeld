---
id: current-inbox-conversation-names
title: Keep Inbox and search conversation names consistent
publishedAt: 2026-10-02
release: v0.3.236
evidence: ["pr:1444","commit:7eba5b84b75cd655b508a8f3cf5959281a11eab3","workflow:37025217534"]
kind: fixed
areas: ["inbox", "spaces", "search"]
audiences: ["users"]
---

Inbox replies, expanded activities, and message search results use the same
current conversation names as the sidebar, including personal chat names.
Renaming a conversation no longer leaves these views showing its old name.
