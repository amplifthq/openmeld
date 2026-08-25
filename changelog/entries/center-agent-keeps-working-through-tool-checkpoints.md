---
id: center-agent-keeps-working-through-tool-checkpoints
title: Center Agent keeps working through tool checkpoints
kind: fixed
areas: ["center-agent", "channels", "tasks"]
audiences: ["members"]
---

Center Agent requests no longer stop just because one internal work loop uses
its tool-call allowance. OpenMeld continues the same request automatically and
publishes only the completed result or a clear failure if the safe continuation
limit is reached.
