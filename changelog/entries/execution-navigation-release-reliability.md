---
id: execution-navigation-release-reliability
title: Clearer task status and more reliable workspace entry
kind: fixed
areas: ["agents", "web", "releases"]
audiences: ["users", "contributors"]
---

OpenCode tasks report running only after the local controller starts the
submitted turn. Workspace entry shows a loading state while access is checked,
and failed checks use the existing recovery page. Coordinated Web, Website,
and Docs releases promote verified build output without reinstalling the full
application toolchain in each deployment job.
