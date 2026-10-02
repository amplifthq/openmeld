---
id: conversation-plugin-connection
title: Open Plugin setup from a conversation
kind: new
areas: ["web", "center-agent", "remote-agent", "integrations"]
audiences: ["members"]
evidence: ["pr:1254"]
---

Agents can offer a Plugin connection action that opens the existing connection
form without leaving the OpenMeld conversation. GitHub, OAuth and supported
credential forms reuse the same flows as Plugins and Onboarding.

Setup preserves personal or Organization intent, shows only permitted choices,
and keeps Agent access separate from connecting an account. Provider consent
is still required; connecting does not automatically resume a task.
