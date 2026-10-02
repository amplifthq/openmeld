---
id: remote-agent-rolling-upgrade-compatibility
title: Keep Remote Agent work running during service upgrades
kind: fixed
areas: ["remote-agent", "releases", "ai-usage"]
audiences: ["users", "operators"]
---

Remote Agent requests can continue while Core and Remote services upgrade at
different times. Usage collected during the transition is retained for delivery
and audit, without repeating model calls. Release checks now account for
dependencies in both directions and block an unverified deployment order.
