---
id: desktop-channel-app-names
title: Distinguish Desktop test and development apps
kind: fixed
areas: ["desktop"]
audiences: ["contributors"]
---

Test and development Desktop builds use explicit Test or Dev names in their
application metadata and native menus. Worktree builds keep their worktree
identifier, while production remains OpenMeld. This makes it easier to select
the correct app in macOS notification settings without combining environments
or resetting notification permissions. Existing historical OS entries are not
automatically removed.
