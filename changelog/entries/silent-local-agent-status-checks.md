---
id: silent-local-agent-status-checks
title: Prevent repeated Antigravity sign-in prompts
kind: fixed
areas: ["local-agents", "service"]
audiences: ["users"]
---

Local Agent status checks no longer run Antigravity's account usage command,
which could repeatedly open Google sign-in pages or request Keychain access.
Antigravity sign-in verification and quota display are unavailable until they
can be checked without interrupting you. You can view them directly in
Antigravity.

Completed signed-out checks are reused between background refreshes. Checking
again explicitly still detects a sign-in completed outside OpenMeld. Missing
login or quota information is never shown as zero remaining capacity.
