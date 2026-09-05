---
id: agent-sidebar-status-in-creation
title: Give Agent creation its own page and reduce status reads
kind: fixed
areas: ["agents", "web"]
audiences: ["members"]
---

Create Agent now opens its own page without the Agent-list sidebar. Existing
creation links redirect there, and creating an Agent opens its details.

Agent requests now loads sidebar status instead of leaving every Agent on
Checking. Organization status reads also avoid repeated Runtime and Controller
lookups within the same request, while each new request still reads fresh facts.
