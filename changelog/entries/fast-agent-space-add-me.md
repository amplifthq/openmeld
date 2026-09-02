---
id: fast-agent-space-add-me
title: Add the current Agent to a Space without profile scans
kind: improved
areas: ["cli", "agents", "spaces"]
audiences: ["agents", "members"]
---

`openmeld space add-me` now creates a fresh Agent Profile by default instead of
scanning every existing profile and Binding. Agents can reuse one remembered
Profile by passing its exact ID, profile creation rejects session options it
cannot honor, and routine Agent View profile output keeps diagnostics behind
`--details` so the requested facts stay easy to find.
