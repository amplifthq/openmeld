---
id: retry-incomplete-agent-profile-setup
title: Retry Agent setup without duplicate Profiles
kind: fixed
areas: ["agents", "web"]
audiences: ["members"]
---

When setup fails after an Agent Profile is created, OpenMeld now keeps and
shows that Profile, clearly labels setup as incomplete, and lets members retry
only the remaining setup for the same Profile, including a custom working
folder still pending on the current computer.
