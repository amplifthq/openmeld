---
id: quiet-web-page-recovery
title: Recover page loading without an error-page flash
kind: fixed
areas: ["web"]
audiences: ["all-users"]
publishedAt: 2026-09-13
release: v0.3.201
evidence: ["pr:979", "pr:980", "commit:a4521fb2865759abbd715be2cab5aa8d41a90b63", "workflow:34738376199"]
---

When page files become unavailable after an update, OpenMeld shows a loading
state while refreshing automatically. If recovery fails, a clear refresh action
appears. Unsaved edits and messages still being sent keep their existing
navigation protections.
