---
id: service-updates-finish-in-the-background
title: Let Service updates finish in the background
kind: fixed
areas: ["cli", "openmeld-service", "setup"]
audiences: ["members", "admins"]
---

OpenMeld Service updates no longer require a Terminal or browser window to stay
open while Agent work finishes. OpenMeld saves the prepared update on the
computer, finishes running work and delivers its results, then switches versions
in the background. If the new Service cannot start, OpenMeld restores the
previous working version automatically.
