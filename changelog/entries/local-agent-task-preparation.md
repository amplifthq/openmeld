---
id: local-agent-task-preparation
title: Less waiting before local Agent tasks start
kind: improved
areas: ["local-agents", "service"]
audiences: ["users", "agents"]
---

Local Agent tasks reuse the current request's identity and Space information
when loading Documents and Skills. This removes repeated preparation requests
while keeping current access checks and the task's selected Skill versions.
Service diagnostics also show how long each preparation read took.
