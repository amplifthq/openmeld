---
id: postgresql-navigation-performance
title: Faster Inbox and workspace navigation
kind: improved
areas: ["inbox", "spaces", "organizations"]
audiences: ["users"]
---

Inbox and workspace navigation avoid repeated database work. Private chat counts
retain current access checks, and routine agent reports skip model-notice checks
when no notice needs to change.
