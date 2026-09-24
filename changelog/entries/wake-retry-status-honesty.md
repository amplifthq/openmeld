---
id: wake-retry-status-honesty
title: Keep Agent availability and Wake progress accurate
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
---

Routine Agent updates no longer briefly stop a healthy computer from accepting Wakes. When the computer is connected but cannot accept a new task yet, Agent and Space views show Checking and the Wake can wait for a bounded period before starting. A rejected delivery is shown as a retry only when the Wake owner confirms it is still waiting; otherwise the message says OpenMeld is checking its status. A confirmed final failure remains visible.
