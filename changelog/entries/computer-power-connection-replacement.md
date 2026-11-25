---
id: computer-power-connection-replacement
title: Report interrupted Computer power requests promptly
kind: fixed
areas: ["computers"]
audiences: ["users", "integrators"]
publishedAt: 2026-11-01
evidence: ["pr:341", "workflow:41279936160"]
---

When OpenMeld Service reconnects, a pending sleep-prevention request on the old
connection now reports that connection was lost instead of waiting for the full
timeout. Settings updates are never replayed automatically. Check the current
setting before trying an interrupted update again.
