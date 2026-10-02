---
id: service-startup-current-state
title: Check current Service state during startup
kind: fixed
areas: ["cli", "service", "windows"]
audiences: ["users"]
---

Service startup checks refresh local running state after operating-system
queries, so a Service that starts during a slow check is not rejected using an
earlier observation. Failure details describe the state that failed the check.
