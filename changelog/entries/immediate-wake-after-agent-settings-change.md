---
id: immediate-wake-after-agent-settings-change
title: Wakes work right after changing agent settings
kind: fixed
areas: ["wake", "agent-profiles", "openmeld-service"]
audiences: ["members"]
---

Changing an Agent Profile's settings, such as its model, no longer makes the
next Wake fail with "the latest settings have not been applied yet". OpenMeld
now waits for the local OpenMeld Service to finish applying the new settings
before delivering the Wake, so an immediate Wake succeeds on its own. If the
Service cannot apply them within a short bounded window, the Wake still fails
closed instead of running with stale settings.
