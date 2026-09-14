---
id: faster-agent-creation-and-space-deletion
title: Move on immediately after creating an Agent or deleting a Space
kind: improved
areas: ["agents", "spaces"]
audiences: ["members"]
---

Agent creation now returns you to Agents as soon as OpenMeld accepts the
request, with honest setup progress until the Agent is ready. Deleting a Space
also removes it from navigation immediately, while either operation restores a
clear, retryable state if the server cannot finish it.
