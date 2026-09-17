---
id: upgrade-aligns-current-cli-service
title: Finish Service updates when the CLI is already current
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.200
evidence: ["pr:974", "pr:975", "commit:de0140fd0892ffb13fd6a670a30a5c96074b6c39", "workflow:34731853294", "smoke:update:5943d0df-fcd3-46b5-9662-340925b4dc06"]
---

Running `openmeld upgrade` now checks the Service even when the CLI is already
up to date. It joins an update already in progress or schedules the remaining
Service work through the existing background updater.
