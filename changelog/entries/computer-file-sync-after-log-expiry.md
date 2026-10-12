---
id: computer-file-sync-after-log-expiry
title: Keep saving Computer files after execution logs expire
kind: fixed
areas: ["computer", "center-agent"]
audiences: ["users", "operators"]
---

Computer can finish saving files after a command has exited and its execution
logs have expired. Recovery keeps the original command result and continues the
saved file transfer without running the command again. Missing source data still
produces an explicit failure.

Operators can update the Remote Agent Worker while retaining its current
containers, recover pending files, and then complete the container rollout.
The intermediate stage remains an incomplete release.
