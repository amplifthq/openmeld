---
id: current-wake-trace-waiting-reason
title: See why a Wake is currently waiting
kind: fixed
areas: ["agents", "spaces", "cli"]
audiences: ["members"]
---

`openmeld service trace --view agent` now shows the current Wake waiting reason,
deadline, and next action when a connected OpenMeld Service is still reporting
an Agent Profile's Wake route. An older attempt error no longer replaces that
authoritative current state.
