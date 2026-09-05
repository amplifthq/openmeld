---
id: preserve-page-loading-errors
title: Preserve page loading errors during refresh
kind: fixed
areas: ["web"]
audiences: ["users"]
---

When an older page cannot load a component after an update, automatic refresh
preserves the original loading error instead of replacing it with a misleading
missing-component error while the refresh is pending.
