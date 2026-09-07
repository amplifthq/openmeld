---
id: computer-connection-recovery-evidence
title: More reliable Computer recovery and clearer failure evidence
kind: fixed
areas: ["computers", "setup", "local-agents"]
audiences: ["users", "operators"]
---

Computer setup can recover from unreadable previous credentials without clearing
unrelated local data. A temporary Keychain timeout no longer disables reads for
the lifetime of the Service. Setup failure diagnostics include verified account
and attempt identifiers so support can investigate the right connection attempt.

Local agent replies use the task-scoped publication path without unrelated CLI
initialization, and repeated identical reply submissions remain idempotent.
