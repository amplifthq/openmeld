---
id: grok-bot-shared-conversations
title: Connect an existing Grok Bot
kind: new
areas: ["agents", "local-service"]
audiences: ["members"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1719", "workflow:38595947657", "commit:4a84cdbcdfeddeaf2a12b8f6bd5dc990afb78b9d", "commit:57246148ea8b2e1fd0b92f2df66f20c52e231c78", "commit:b461313d90eca6d6283b28e784ecb61625692886", "workflow:38596949076", "workflow:38591154751"]
---

Connect an existing Grok Bot through an ordinary Agent Profile. Send work and
receive replies through the same OpenMeld conversations used by other Agents.
The connection shares the Bot's original conversation, including its stop
control. A short confirmation explains this when you connect.

Newly created and selected Agents stay at the top of the people-and-agents
picker. Agent creation runs in the background so you can keep choosing members.
