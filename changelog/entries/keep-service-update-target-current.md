---
id: keep-service-update-target-current
title: Keep pending Service updates on the newest version
kind: fixed
areas: ["cli", "openmeld-service", "setup"]
audiences: ["members", "admins"]
---

When a newer OpenMeld Service version becomes available while an update is
already waiting, OpenMeld now replaces the older target with the newer version.
The existing update remains recoverable until the newer target is safely saved,
and an older worker or queued request cannot overwrite that target or move the
Service back to an earlier version.
