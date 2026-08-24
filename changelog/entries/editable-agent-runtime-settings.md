---
id: editable-agent-runtime-settings
title: Edit Agent settings without leaving active work
kind: improved
areas: ["agents", "spaces", "local-service"]
audiences: ["members"]
---

Agent owners can now save OpenCode permissions that remain after reopening and
apply to new work. While a Wake is running, they can still change the model,
reasoning effort, and future permissions—including from an in-Space permission
request—while disruptive Controller changes, unbinding, and working-folder
changes remain unavailable from Agents and every Space until active work
finishes, including when a new Wake starts just as the change is submitted. A
Controller reconnect also preserves a newer settings choice made at the same
time. OpenMeld distinguishes saved settings, computer sync, and unchanged
current work. The active-work protection applies to every supported local Agent
Controller; Codex and OpenCode keep their own controller-specific permission
options.
