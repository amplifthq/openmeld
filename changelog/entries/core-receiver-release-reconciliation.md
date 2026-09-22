---
id: core-receiver-release-reconciliation
title: Resume Core receiver releases after alignment failures
kind: fixed
areas: ["releases"]
audiences: ["operators"]
---

Core receiver releases retain the applied deployment before checking channel
alignment, so a failed check can resume without deploying again. A guarded
reconciliation path can recover the known receiver release whose original runner
did not retain that evidence. Historical npm packaging defects remain visible
without weakening checks for new CLI releases.
