---
id: recover-stuck-openmeld-service-upgrades
title: Recover stuck OpenMeld Service upgrades
kind: fixed
areas: ["openmeld-service", "computers", "local-agents"]
audiences: ["members"]
publishedAt: 2026-09-03
release: v0.3.150
evidence: ["pr:590", "commit:3ab67378a11a362bf0af47855bc90849c1ae16a2", "commit:dfdea32b57e045cfe10da6cd178e9ff427ec400e", "workflow:33737438439", "workflow:33738300809", "workflow:33738311319", "smoke:75da469f-7c8b-400f-bf7e-b434d2fc02ec,c16045ec-d8de-4afc-935b-d585be6c4004,513bfcd8-8598-49db-bbd0-28094c998015"]
---

OpenMeld setup now recovers when an older Service is stuck closing a stale
connection, while preserving active local work and durable results. Computer
details also distinguish a delayed local-agent check from a disconnected
Service, show when the last trusted check completed, and offer a focused retry.
