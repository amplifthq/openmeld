---
id: notification-message-navigation
title: Open messages from notifications with less waiting
kind: improved
areas: ["inbox", "spaces", "desktop"]
audiences: ["members"]
publishedAt: 2026-09-16
release: v0.3.212
evidence: ["pr:1128", "pr:1133", "pr:1134", "commit:b8dcd2b62dab99a9f852783550a913afe718abd4", "workflow:35133498793", "desktop-candidate:76d8b271aadb5cb125ef445337c150bec1f1409854d6f599bf2927b41d85dc86"]
---

Browser notifications open conversations without reloading the app. Desktop
brings its window forward promptly and reuses the checked notification target.
Linked Threads can show messages while the rest of the Space is still loading.
