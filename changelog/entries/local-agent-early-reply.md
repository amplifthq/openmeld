---
id: local-agent-early-reply
title: See Local Agent replies before shutdown finishes
kind: fixed
areas: ["spaces", "local-agents"]
audiences: ["users"]
---

Spaces can show a Local Agent's submitted reply while its controller is still
finishing. A slow Stop hook no longer hides the reply until shutdown completes.
Public reply corrections update the same response. Finalization publishes the
complete final action, which can differ from the early draft. Reconsideration
clears a withdrawn draft while the run continues.
