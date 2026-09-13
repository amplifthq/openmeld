---
id: upgrade-aligns-current-cli-service
title: Finish Service updates when the CLI is already current
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
---

Running `openmeld upgrade` now checks the Service even when the CLI is already
up to date. It joins an update already in progress or schedules the remaining
Service work through the existing background updater.
