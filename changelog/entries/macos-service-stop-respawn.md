---
id: macos-service-stop-respawn
title: Keep OpenMeld Service stopped after a successful shutdown on macOS
kind: fixed
areas: ["cli", "computer"]
audiences: ["users"]
---

Stopping OpenMeld Service on macOS no longer automatically starts a replacement
after the original process finishes successfully. Abnormal exits still trigger
system recovery. Account checks, task draining, and result confirmation remain
required before Stop can finish.
