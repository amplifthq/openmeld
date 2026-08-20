---
id: complete-local-agent-session-inventory
title: See your Organization's complete Local Agent Session Inventory
kind: improved
areas: ["agent-activity", "agents"]
audiences: ["members"]
---

Agent Activity now gives Organization members one paginated, metadata-only
inventory of authorized Local Agent Sessions across connected Projects. Web,
CLI, Local Agents, and the Center Agent share native Session titles and IDs,
owners, Projects, Computers, status, capabilities, and Agent Profile Binding
facts. Resume rechecks the current authorized Session before connecting it to a
new Agent Profile and removes an incomplete Agent if that Session changes during
creation. Claude Code Session endings and API failures now update the inventory
from explicit provider hooks.
