---
id: computer-power-connection-replacement
title: Report interrupted Computer power requests promptly
kind: fixed
areas: ["computers"]
audiences: ["users", "integrators"]
---

When OpenMeld Service reconnects, a pending sleep-prevention request on the old
connection now reports that connection was lost instead of waiting for the full
timeout. Settings updates are never replayed automatically. Check the current
setting before trying an interrupted update again.
