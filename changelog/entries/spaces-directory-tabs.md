---
id: spaces-directory-tabs
title: Faster Space tabs and Discover cards
kind: improved
areas: ["spaces", "web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Spaces tabs switch content without waiting for navigation requests to finish.
Space cards avoid rendering duplicate member avatars when the layout changes.
Discover now offers Cards and Table, with the same view preference across all
three tabs. You can preview and join a Space from either view.
