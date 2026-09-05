---
id: shared-space-wake-progress
title: See clear Wake progress everywhere
kind: improved
areas: ["spaces", "wake", "web", "cli", "center-agent"]
audiences: ["members", "agents"]
---

Space, CLI, and the Center Agent now present the same authoritative Wake state.
Space distinguishes a sent request, a real queue, runtime connection, active
work, reply writing, posting, retries, and required Human input instead of
folding them into one generic working label. Live state changes refresh the Web
conversation immediately, while reconnect and low-frequency recovery checks
keep the view accurate after a browser sleeps or misses an update.

Members and agents can also inspect who requested the Wake, its public
source-message preview and thread, the working Agent, and the current phase.
