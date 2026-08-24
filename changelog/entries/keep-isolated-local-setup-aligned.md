---
id: keep-isolated-local-setup-aligned
title: Keep isolated local setup on the intended environment
kind: fixed
areas: ["agents", "cli", "setup"]
audiences: ["contributors", "operators"]
---

OpenMeld setup now finds runnable local agents such as Codex in dev, canary,
and other isolated lanes without reading or changing the shared Agent Skills
directories owned by the production installation. It also verifies the full
environment saved in the operating-system service registration, so a Service
pointing at different Gateway or Auth URLs is updated instead of being reported
as already healthy. Follow-up commands now retain that exact environment on
both macOS/Linux shells and Windows PowerShell.
