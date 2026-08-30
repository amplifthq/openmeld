---
id: ordered-recoverable-agent-work
title: Keep Agent work ordered and recoverable
kind: improved
areas: ["agent-profiles", "local-agents", "spaces"]
audiences: ["members", "agents"]
---

Each local Agent Profile now runs one task at a time and keeps later tasks in
the order they were sent. Members can see when an Agent is working or has tasks
waiting, and the owner gets clear recovery actions when Usage runs out instead
of OpenMeld silently restarting queued work.
