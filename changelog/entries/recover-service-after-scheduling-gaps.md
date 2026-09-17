---
id: recover-service-after-scheduling-gaps
title: Keep connection-check deadlines from being postponed
kind: fixed
areas: ["computers", "openmeld-service"]
audiences: ["users"]
---

OpenMeld Service now keeps a fixed deadline for each unanswered connection
check. A later check can no longer postpone that timeout; when it expires, the
existing connection cleanup and reconnect path continues as before.
