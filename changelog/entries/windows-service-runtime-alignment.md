---
id: windows-service-runtime-alignment
title: Recognize Windows Service paths and system ownership
kind: fixed
areas: ["cli", "service"]
audiences: ["users"]
---

Service health checks recognize Windows bundle paths with backslashes and avoid
counting one verified system-managed process as both a system and direct owner.
Startup progress no longer labels Windows as macOS.
