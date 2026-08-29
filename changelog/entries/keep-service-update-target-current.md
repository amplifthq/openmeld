---
id: keep-service-update-target-current
title: Keep pending Service updates on the newest version
kind: fixed
areas: ["cli", "openmeld-service", "setup"]
audiences: ["members", "admins"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:473", "commit:f091298b264fb77e63a65cb86a7870c99b293ef7", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "pr-comment:5463688488"]
---

When a newer OpenMeld Service version becomes available while an update is
already waiting, OpenMeld now replaces the older target with the newer version.
The existing update remains recoverable until the newer target is safely saved,
and an older worker or queued request cannot overwrite that target or move the
Service back to an earlier version.
