---
id: local-agent-status-stays-steady
title: Keep healthy local agents from flashing "Can't start"
kind: fixed
areas: ["agents", "computers"]
audiences: ["users"]
---

Healthy local agents on a connected computer no longer flip to "Can't start"
for a few seconds every couple of minutes. OpenMeld Service now renews each
agent check before it expires and checks several agents at once. A slow or
timed-out check keeps the agent's last good state instead of marking it broken.
When a check is late, the computer page shows a neutral "Check delayed" rather
than an error. "Can't start" now appears only when an agent actually failed to
launch.
