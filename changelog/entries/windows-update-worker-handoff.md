---
id: windows-update-worker-handoff
title: Resume Windows setup when an update was not started
kind: fixed
areas: ["computer-connection", "windows"]
audiences: ["members"]
---

Windows setup now wakes the background updater for an earlier update that was never started. If the updater still does not start, setup reports the failure instead of waiting indefinitely. New update requests also report a failed handoff to the background task.
