---
id: computer-account-handoff-connectivity
title: Keep computer status accurate when switching accounts
kind: fixed
areas: ["service", "cli"]
audiences: ["users"]
---

When you connect a computer to a different account, the previous account shows
it as disconnected after the Service confirms the stop. Older connections no
longer keep that computer online, including after a server restart. Routine
Service updates keep their existing reconnection grace period.

If the Service cannot confirm its final connection update, stopping reports
the failure after accepted work finishes instead of reporting success.
