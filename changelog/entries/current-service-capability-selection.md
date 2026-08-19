---
id: current-service-capability-selection
title: Use the current Service's controls
kind: fixed
areas: ["computers", "service", "web"]
audiences: ["members"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:143", "commit:b192a404a2a3fd7c3e33838d3db9d5d47ead4a6b", "workflow:32255551305", "workflow:32256652038"]
---

Computer controls now follow the newest OpenMeld Service session for that
device and lane. An older reconnecting session can no longer make file access,
folder selection, Project controls, or local Agent controls appear available
when the current Service does not support them.
