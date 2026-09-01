---
id: converge-openmeld-tools-updates
title: Keep one OpenMeld Tools update in control
kind: fixed
areas: ["cli", "computers", "openmeld-service", "setup"]
audiences: ["members", "admins"]
---

OpenMeld Tools updates now join an update already in progress instead of
starting a competing CLI or Setup path. Manual Setup waits and continues
automatically, and the Computer page keeps the active update visible after a
refresh.

Automatic updates can also respond to a newly available release over the
Service's existing connection. Startup, reconnect, and hourly checks remain as
fallbacks, and active Agent work still finishes before OpenMeld switches the
Service version.
