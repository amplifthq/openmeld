---
id: windows-service-cold-start-readiness
title: Allow Windows Service to finish a cold start
kind: fixed
areas: ["computer-connection", "windows"]
audiences: ["members"]
---

Connecting a Windows computer now gives the background Service enough time to finish a cold start before reporting a startup failure. OpenMeld still checks the Service's actual running state and installation ownership before completing setup.
