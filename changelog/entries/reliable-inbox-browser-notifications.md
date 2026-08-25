---
id: reliable-inbox-browser-notifications
title: Get browser alerts for important Inbox updates
kind: new
areas: ["inbox", "notifications"]
audiences: ["members"]
publishedAt: 2026-08-25
release: v0.3.104
evidence: ["pr:182", "commit:b1ad7d52c508e69fc638b0bb4043c8fb748139b8", "commit:80bd8e299715b9a29b2a17b617742de048a360d1", "workflow:32819146613", "workflow:32819561308", "workflow:32820131502"]
---

Members can enable browser notifications for directly addressed messages,
actions, urgent items, and requested work endings. OpenMeld avoids interrupting
the conversation already on screen, checks the latest Inbox state before a
queued alert appears, and keeps failed deliveries retryable across account or
conversation changes, refreshes, busy Inbox pages, and multiple tabs.
