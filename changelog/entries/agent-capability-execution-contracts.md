---
id: agent-capability-execution-contracts
title: More accurate Agent capabilities and execution results
kind: fixed
areas: ["center-agent", "remote-agent", "integrations"]
audiences: ["members"]
evidence: ["pr:1254"]
---

Agents can discover and use executable GitHub actions from the connected
plugin's current catalog, including workflow job logs when the plugin provides
them, without changing the selected account or bypassing access controls.

Center Agent creation explicitly supports Local and Remote Agents. Working
creation requires an execution target, keeps accepted work separate from
completed setup and current readiness, and distinguishes otherwise similar
creation requests for different Spaces.

Oversized tool results retain bounded evidence and available operation receipts
instead of treating a presentation limit as an execution failure. Partial
content is clearly identified; omitted content is not advertised as available
for continuation, and recovering a display must not repeat a write.
