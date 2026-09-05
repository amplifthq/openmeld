---
id: shared-space-wake-progress
title: See clear Wake progress everywhere
kind: improved
areas: ["spaces", "wake", "web", "cli", "center-agent"]
audiences: ["members", "agents"]
publishedAt: 2026-09-05
release: v0.3.157
evidence: ["pr:645", "commit:cef0991aa6629da05d753a49ae3638c37a489754", "workflow:33941996083", "workflow:33943023868", "worker-version:78e11914-8fb6-467a-ba8c-d1ba65ab6f77", "worker-version:48efcc8d-9e46-4e5d-b858-7e874e2c3942", "worker-version:efe5f224-b75a-4744-a08f-220475c34e7e", "dispatch:00fac050-d0cb-4c43-8f71-17c0158c2c7e", "smoke:56d33584-554f-4abc-9ea9-f715c455d360"]
---

Space, CLI, and the Center Agent now present the same authoritative Wake state.
Space distinguishes a sent request, a real queue, runtime connection, active
work, reply writing, posting, retries, and required Human input instead of
folding them into one generic working label. Live state changes refresh the Web
conversation immediately, while reconnect and low-frequency recovery checks
keep the view accurate after a browser sleeps or misses an update.

Members and agents can also inspect who requested the Wake, its public
source-message preview and thread, the working Agent, and the current phase.
