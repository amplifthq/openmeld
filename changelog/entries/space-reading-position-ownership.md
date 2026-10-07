---
id: space-reading-position-ownership
title: Keep your place when returning to a conversation
kind: fixed
areas: ["spaces", "web"]
audiences: ["users"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1454", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "commit:60509153ca78fd785360206369f803b6f5b58f7d"]
---

Returning to a conversation keeps you at the latest messages if you left it at
the bottom, or at your saved message if you were reading earlier history.
Page navigation no longer overwrites the conversation's restored position or
an explicit message jump with old scroll coordinates.
