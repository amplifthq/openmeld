---
id: recover-service-after-scheduling-gaps
title: Recover stale connections after computer wake
kind: fixed
areas: ["computers", "openmeld-service"]
audiences: ["users"]
---

OpenMeld Service now keeps a fixed deadline for each unanswered connection
check. Delayed timers after a computer wakes can no longer keep postponing the
detection of a stale connection, so the existing reconnect and saved-result
recovery flow can take over without a manual reconnect.
