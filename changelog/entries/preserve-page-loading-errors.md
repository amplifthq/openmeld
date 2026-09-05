---
id: preserve-page-loading-errors
title: Preserve page loading errors during refresh
kind: fixed
areas: ["web"]
audiences: ["users"]
publishedAt: 2026-09-05
evidence: ["pr:667", "commit:c1ee150e627e974dbb541cd6b8c3db6b673ce73f", "workflow:33953073945"]
---

When an older page cannot load a component after an update, automatic refresh
preserves the original loading error instead of replacing it with a misleading
missing-component error while the refresh is pending.
