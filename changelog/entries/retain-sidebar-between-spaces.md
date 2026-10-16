---
id: retain-sidebar-between-spaces
title: Switch Spaces with less sidebar work
kind: improved
areas: ["spaces", "web", "desktop"]
audiences: ["members"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["pr:205", "commit:e7bcf2f444662ce4acc618d32354e378ce8df3fc"]
---

Switching between Spaces keeps the conversation sidebar in place and avoids
rebuilding unchanged rows. This reduces navigation delays in Web and Desktop,
especially when your sidebar contains many conversations.
