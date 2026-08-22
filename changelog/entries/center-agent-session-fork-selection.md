---
id: center-agent-session-fork-selection
title: Fork an existing Session with the Center Agent
kind: fixed
areas: ["agent-activity", "agent-profiles", "center-agent"]
audiences: ["members"]
---

The Center Agent can preserve an existing Session's exact Project, Computer,
local agent, and provider-native Session ID when creating an Agent Profile with
Fork or Resume. An unbound Session is a valid Fork source when its provider
reports that Fork is supported. OpenMeld still verifies the complete selection
before creating the Agent Profile.
