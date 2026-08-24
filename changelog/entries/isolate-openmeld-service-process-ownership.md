---
id: isolate-openmeld-service-process-ownership
title: Keep each OpenMeld Service repair in its own environment
kind: fixed
areas: ["agents", "cli"]
audiences: ["members", "admins"]
---

OpenMeld Service repair now recognizes the full OpenMeld home that owns each
managed Service process. A Service running in an isolated development or test
environment no longer blocks, stops, or appears as part of the installed
OpenMeld Service on the same computer.
