---
id: agent-creation-setup-retry
title: Finish Agent setup reliably after creation
kind: fixed
areas: [agents, projects]
audiences: [users]
---

Creating an Agent now finishes its working folder before setting its Default
Project. If setup needs a retry, OpenMeld continues with the remaining steps
instead of repeating steps that already finished.
