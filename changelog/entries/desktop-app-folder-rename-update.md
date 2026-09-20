---
id: desktop-app-folder-rename-update
title: Keep the Desktop app path stable across updates
kind: fixed
areas: ["desktop"]
audiences: ["users"]
---

Desktop now treats the installed `OpenMeld.app` folder name as part of its
production update identity. Same-name macOS updates continue through the native
Squirrel updater, while missing, legacy, or unexpected app-folder paths stop
instead of attempting another unsafe rename. A small local receipt also records
whether the requested new Desktop version actually started after installation.
