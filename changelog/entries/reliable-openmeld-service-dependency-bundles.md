---
id: reliable-openmeld-service-dependency-bundles
title: Install OpenMeld Service with every packaged dependency
kind: fixed
areas: ["openmeld-service", "cli"]
audiences: ["members"]
---

OpenMeld Service now installs correctly when a packaged dependency has the
same name as a built-in Node.js module. A fresh setup can finish connecting
the user's computer instead of stopping while preparing the background
service.
