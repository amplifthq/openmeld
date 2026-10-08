---
id: local-agent-discovery-progress
title: Local agents appear sooner
kind: improved
areas: ["agents", "computer", "cli"]
audiences: ["users"]
---

Local agents appear as their checks finish, without waiting for every installed
agent to be checked. First-time discovery avoids repeating the same installation
checks after registration. Requests for a specific agent check that agent only.
