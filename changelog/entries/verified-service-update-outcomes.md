---
id: verified-service-update-outcomes
title: Verify OpenMeld Service updates before reporting success
kind: fixed
areas: ["computers", "cli", "web"]
audiences: ["members"]
---

OpenMeld 0.3.156 is the first release with both automatic update delivery and
verified Service startup. Version 0.3.155 can update automatically; version
0.3.153 needs one manual `openmeld upgrade --yes` bridge to reach this reliable
baseline. Background updates now wait for a positive safe-switch signal, keep
running Agent work intact, report restored updates as failures, and avoid
asking users to repair a healthy Service while macOS is still starting it.
