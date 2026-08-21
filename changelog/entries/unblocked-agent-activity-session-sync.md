---
id: unblocked-agent-activity-session-sync
title: Keep Agent Activity Session sync moving
kind: fixed
areas: ["agent-activity", "cli"]
audiences: ["members"]
---

OpenMeld now skips retained Local Agent Sessions that are clearly outside every
connected Project before accessing their local paths. An unavailable old
workspace no longer blocks the current Project's Session Inventory from
syncing.
