---
id: desktop-app-folder-rename-update
title: Keep Desktop updates working after the app folder rename
kind: fixed
areas: ["desktop"]
audiences: ["users"]
---

Updating an older Desktop install named OpenMeld Desktop no longer hands the
download to macOS ShipIt, which tried to relaunch the old folder after moving
it to OpenMeld. Restart now installs the verified update as OpenMeld and opens
that app.
