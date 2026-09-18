---
id: verify-local-agent-install-changes
title: Verify a local Agent before switching installs
kind: fixed
areas: ["agents", "cli", "computers"]
audiences: ["members", "admins"]
publishedAt: 2026-09-16
release: v0.3.212
evidence: ["pr:1031", "pr:1133", "commit:b8dcd2b62dab99a9f852783550a913afe718abd4", "workflow:35136910148"]
---

When OpenMeld discovers a local Agent for the first time or you choose a
different installation during repair, it now verifies that exact installation
can start before saving it or reporting it ready. A failed or unfinished check
keeps the available choices visible; repair also preserves the current install
and its enabled setting so you can safely retry.
