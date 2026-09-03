---
id: agent-wakeability-follows-current-facts
title: Keep Agent Wake availability tied to current conditions
kind: fixed
areas: ["agents", "spaces", "web"]
audiences: ["members"]
---

Agent availability now follows current Computer, local agent, Usage Limit, and
working-folder conditions instead of an earlier Wake failure. Activity can load
independently. When Usage becomes available again, OpenMeld can continue one
interrupted task as a separate Wake without exposing a manual retry action.
