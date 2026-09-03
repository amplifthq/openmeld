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
interrupted task as a separate Wake with its original Project, files, and Agent
references, without exposing a manual retry action. If one of those original
message targets or file revisions is no longer available, OpenMeld now asks for
review instead of retrying the continuation forever.
