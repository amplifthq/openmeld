---
id: use-current-working-folder-for-wakes
title: Keep Wakes on the current working folder
kind: fixed
areas: ["agents", "projects", "service"]
audiences: ["members"]
---

OpenMeld Service now uses the same current working-folder decision when it
checks an Agent, plans its route, and runs a Wake. Changing or removing a
Default Project connection is reflected without reconnecting the computer or
rebuilding the Agent. Computers with an older Service are asked to update before
accepting new Wakes, while work already in progress remains attached to its
original Wake.
