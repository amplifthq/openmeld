---
id: local-agent-early-reply
title: See Local Agent replies before shutdown finishes
kind: fixed
areas: ["spaces", "local-agents"]
audiences: ["users"]
---

Spaces can show a Local Agent's submitted reply while its controller is still
finishing. A slow Stop hook no longer hides the reply until shutdown completes.
The same reply becomes final when the run finishes.
