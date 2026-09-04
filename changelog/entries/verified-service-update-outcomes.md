---
id: verified-service-update-outcomes
title: Verify OpenMeld Service updates before reporting success
kind: fixed
areas: ["computers", "cli", "web"]
audiences: ["members"]
---

OpenMeld now keeps background Service updates in progress until the exact CLI
and Service versions are running, reports restored updates as failures, and
avoids asking users to repair a healthy Service while macOS is still starting
it.
