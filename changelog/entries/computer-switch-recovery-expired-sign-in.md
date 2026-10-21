---
id: computer-switch-recovery-expired-sign-in
title: Sign in again after an interrupted Computer account switch
kind: fixed
areas: ["cli", "local-service"]
audiences: ["users"]
---

If a Computer account switch stopped partway and the previous account's
sign-in on that computer had already expired, `openmeld login` and
`openmeld logout` no longer stay blocked by the unfinished recovery. OpenMeld
now finishes the recovery itself: OpenMeld Service stays stopped instead of
reconnecting an account that can no longer sign in, the unused setup session is
revoked, and you can sign in again or run a new setup command.
