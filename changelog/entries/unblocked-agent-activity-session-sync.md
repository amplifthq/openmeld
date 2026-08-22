---
id: unblocked-agent-activity-session-sync
title: Keep Agent Activity Session sync moving
kind: fixed
areas: ["agent-activity", "cli"]
audiences: ["members"]
---

OpenMeld now keeps Session Inventory syncing when an old workspace path is
unavailable, and correctly attributes Sessions opened through arbitrary symlink
aliases to the Project that owns the real target path. Path lookup failures
affect only that Session instead of blocking the current Project's inventory.
