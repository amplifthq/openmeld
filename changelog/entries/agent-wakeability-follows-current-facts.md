---
id: agent-wakeability-follows-current-facts
title: Keep Agent Wake availability tied to current conditions
kind: fixed
areas: ["agents", "spaces", "web"]
audiences: ["members"]
---

Agent availability now follows current Computer, local agent, Usage Limit, and
working-folder conditions instead of an earlier Wake failure. Activity can load
independently, and running a failed request again starts as a separate new Wake.
