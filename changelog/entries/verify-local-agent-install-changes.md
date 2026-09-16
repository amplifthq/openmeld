---
id: verify-local-agent-install-changes
title: Verify a local Agent before switching installs
kind: fixed
areas: ["agents", "cli", "computers"]
audiences: ["members", "admins"]
---

When OpenMeld discovers a local Agent for the first time or you choose a
different installation during repair, it now verifies that exact installation
can start before saving it or reporting it ready. A failed or unfinished check
keeps the available choices visible; repair also preserves the current install
and its enabled setting so you can safely retry.
