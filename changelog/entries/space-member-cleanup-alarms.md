---
id: space-member-cleanup-alarms
title: Stop repeated background checks for removed Space members
kind: fixed
areas: ["spaces"]
audiences: ["operators"]
---

Spaces stop scheduling member cleanup when a removed Agent Profile leaves
behind an old observation. Active members still receive a fresh identity
check once enough evidence has accumulated.
