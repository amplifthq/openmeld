---
id: clear-profile-report-save-attention
title: Review and save Profile Report updates
kind: fixed
areas: ["documents", "inbox", "center-agent"]
audiences: ["members", "admins"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:141", "commit:6e60eb65dc0b6a7c4edfc9d0434c991acb274019", "workflow:32255551305", "workflow:32256652038"]
---

Pending Profile Report updates now explain that they need to be reviewed and
saved. The existing **Save changes** action accepts the visible update even when
no text edit is needed, then clears the matching Inbox action.
