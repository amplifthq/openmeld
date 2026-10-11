---
id: profile-setup-computer-identity
title: Complete Computer connection during Agent setup
kind: fixed
areas: ["cli", "computer", "agents"]
audiences: ["users"]
---

Setting up an Agent Profile also completes its Computer connection. This lets
the matching account start and stop OpenMeld Service after setup. If the
connection cannot be saved, setup reports the failure before showing completion.
If the account or Service changes during setup, start setup again. The earlier
result cannot replace the new connection or restart a stopped Service.
