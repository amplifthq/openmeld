---
id: recover-stuck-openmeld-service-upgrades
title: Recover stuck OpenMeld Service upgrades
kind: fixed
areas: ["openmeld-service", "computers", "local-agents"]
audiences: ["members"]
---

OpenMeld setup now recovers when an older Service is stuck closing a stale
connection, while preserving active local work and durable results. Computer
details also distinguish a delayed local-agent check from a disconnected
Service, show when the last trusted check completed, and offer a focused retry.
