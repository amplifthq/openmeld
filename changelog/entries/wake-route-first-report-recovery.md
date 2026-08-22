---
id: wake-route-first-report-recovery
title: Keep Wakes waiting while agents become ready
kind: fixed
areas: ["wake", "openmeld-service"]
audiences: ["members"]
---

OpenMeld now keeps a Wake waiting while a connected OpenMeld Service finishes
reporting the agent's local route. If the route does not become ready before
the bounded wait ends, the Space explains that the Service was connected and
suggests trying the Wake again instead of telling people to reconnect it.
