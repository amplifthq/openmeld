---
id: wake-admission-honors-current-readiness
title: Stop unavailable Wakes before execution
kind: fixed
areas: ["agent-profiles", "wakes", "local-agents"]
audiences: ["members"]
---

New Wakes now stop with a clear next step when reliable Usage evidence shows
that a provider is exhausted or the selected Local Agent is disabled. Work that
was already accepted is checked again before it starts, so it cannot wait
silently and run later after the Local Agent is enabled again.
