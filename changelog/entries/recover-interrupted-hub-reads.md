---
id: recover-interrupted-hub-reads
title: Recover interrupted Agent status and work recovery reads
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users", "operators"]
---

Agent status, connection lookups, and paused-work recovery reads can recover
from transient platform instance interruptions within a bounded request budget.
Retries preserve current access checks and do not replay actions or device
commands. Overload failures stop immediately, and exhausted reads remain
unavailable rather than reporting that an Agent is offline or has no paused work.
