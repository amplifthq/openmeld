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
request. Update actions bypass an older version cached by the running Service,
while simultaneous checks still share one fresh request. Startup, reconnect,
and hourly checks remain as fallbacks, failed connections can retry promptly,
and active Agent work still finishes before OpenMeld switches the Service
version.

The CLI update prompt now also restarts a newly installed standalone binary
without treating its internal build path as a command, so the menu continues
cleanly after the upgrade.

Update cleanup is also isolated to the current OpenMeld lane, so a Development
or Canary Service cannot block or be stopped by a Production update. After a
repair reaches the requested version, the Computer page now shows the current
healthy result instead of keeping a historical update failure on screen.
