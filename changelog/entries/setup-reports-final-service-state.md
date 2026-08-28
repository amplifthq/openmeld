---
id: setup-reports-final-service-state
title: Setup now reports the final Service state safely
kind: fixed
areas: ["computers", "openmeld-service", "setup"]
audiences: ["members"]
---

Computer setup now finishes successfully after OpenMeld Service recovers from
a temporary start delay, and shows the Service as connected even when no local
agents are installed yet. Development, Staging, and Canary setup also stay
isolated from the published OpenMeld Service on the same computer.
