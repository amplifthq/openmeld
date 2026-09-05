---
id: verified-service-update-outcomes
title: Verify OpenMeld Service updates before reporting success
kind: fixed
areas: ["computers", "cli", "web"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.156
evidence: ["pr:638", "commit:0413ec38f72a8185c13c53166df4b062a68f3e0d", "tag:v0.3.156", "npm:openmeld@0.3.156", "tag:v0.3.157", "npm:openmeld@0.3.157", "workflow:33943023868", "smoke:service:auto-update-0.3.157-20260905", "dispatch:00fac050-d0cb-4c43-8f71-17c0158c2c7e"]
---

OpenMeld 0.3.156 is the first release with both automatic update delivery and
verified Service startup. Version 0.3.155 can update automatically; version
0.3.153 needs one manual `openmeld upgrade --yes` bridge to reach this reliable
baseline. Background updates now wait for a positive safe-switch signal, keep
running Agent work intact, report restored updates as failures, and avoid
asking users to repair a healthy Service while macOS is still starting it.
