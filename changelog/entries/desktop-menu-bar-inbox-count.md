---
id: desktop-menu-bar-inbox-count
title: See unread Inbox items in the Mac menu bar
kind: new
areas: ["desktop", "inbox"]
audiences: ["users"]
publishedAt: 2026-09-16
release: v0.3.212
evidence: ["pr:1131", "pr:1133", "pr:1134", "commit:b8dcd2b62dab99a9f852783550a913afe718abd4", "desktop-candidate:76d8b271aadb5cb125ef445337c150bec1f1409854d6f599bf2927b41d85dc86"]
---

The OpenMeld menu bar icon shows your current workspace's unread Inbox count,
including ordinary messages, even when the Desktop window is hidden. The number
is independent of notification permissions and disappears when there are no
unread items, the count is unavailable, or you sign out.
