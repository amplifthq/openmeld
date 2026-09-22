---
id: wake-delivery-decision-diagnostics
title: Preserve the connection facts behind a Wake delivery decision
kind: improved
areas: ["diagnostics", "agents"]
audiences: ["contributors"]
---

Wake delivery diagnostics now retain the lease, session, socket, and route facts
observed at the actual delivery decision. Later reconnects cannot replace that
evidence, making an offline rejection easier to investigate without changing
readiness, retry behavior, or execution ownership.
