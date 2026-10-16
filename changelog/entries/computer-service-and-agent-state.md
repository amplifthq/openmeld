---
id: computer-service-and-agent-state
title: More reliable computer connections and local agent status
kind: fixed
areas: ["computers", "local-agents", "desktop"]
audiences: ["users", "operators"]
---

Computer connections recover after long disconnects. Service stop requests
return within a bounded wait while accepted work can finish safely. Repair
checks the connection and local execution host before reporting success.

Local agent account checks refresh more often, and cached checks cannot keep
old sign-in information current. Delayed checks report refreshed status without
claiming that an unconfirmed request completed. Desktop users can update or
reconnect their current computer through the native connection flow.

Desktop detects damaged application archives before launch. Its connection flow
shows a stopped Service as disconnected and supports updates from older CLI
versions that do not recognize the stopped-connection check.

The Service update is required for the shorter account-check freshness window.
