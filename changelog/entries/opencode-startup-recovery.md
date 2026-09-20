---
id: opencode-startup-recovery
title: Give OpenCode time to start without restarting it too soon
kind: fixed
areas: ["agents", "service"]
audiences: ["users", "developers"]
---

OpenMeld no longer restarts an OpenCode server after only five seconds when it
is still starting normally. Startup recovery remains bounded to one replacement
before the Agent task begins. Failure details identify the startup stage and
attempt, and preserve safe diagnostic output instead of reporting only a timeout.
