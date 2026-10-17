---
id: desktop-service-update-wait
title: Clearer waiting during computer updates
kind: fixed
areas: ["desktop", "cli", "service"]
audiences: ["users"]
---

Computer setup explains when an update is waiting for current tasks and continues
automatically when they finish. Confirmed running tasks no longer cause setup to
stop at its 15-minute limit. Desktop waits for an existing update before requesting
new connection credentials, so that wait does not use up their validity period.

Running tasks keep their Stop control when the Agent's startup readiness report
expires or becomes unavailable. OpenMeld still waits for the Agent to confirm
that the task stopped.

Codex configuration checks use the cold-start allowance, so a slow configuration
or network-policy load does not stop startup at the shorter metadata deadline.
