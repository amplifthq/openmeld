---
id: converge-openmeld-tools-updates
title: Keep one OpenMeld Tools update in control
kind: fixed
areas: ["cli", "computers", "openmeld-service", "setup"]
audiences: ["members", "admins"]
---

OpenMeld Tools updates now join an update already in progress instead of
starting a competing CLI or Setup path. Manual Setup waits and continues
automatically. On the Computer page, the button stays disabled with an active
`Updating…` cue after a refresh, and the concise status moves through
`Checking…`, `Finishing…`, `Updating…`, or `Verifying…`.

Automatic updates can also respond to a newly available release over the
Service's existing connection when that Service explicitly supports the
request. Startup, reconnect, and hourly checks remain as fallbacks, failed
connections can retry promptly, and active Agent work still finishes before
OpenMeld switches the Service version.
