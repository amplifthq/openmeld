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
