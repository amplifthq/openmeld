---
id: center-agent-continuation-admission-recovery
title: Retry Center Agent continuations that fail to start
kind: fixed
areas: ["center-agent", "reliability"]
audiences: ["members"]
---

OpenMeld now retries a Center Agent task continuation when the hosted runtime
does not acknowledge startup. If all three attempts fail, the requester gets an
urgent Inbox item linked to the original task result instead of silently losing
the continuation.
