---
id: session-history-discovery-and-queued-wakes
title: More reliable Codex session discovery and queued Wakes
kind: fixed
areas: ["agent-activity", "computer", "agents"]
audiences: ["users", "agents"]
---

Codex session discovery now handles repeated native task records and uses the
task's update time. The Computer page shows discovery problems and keeps each
page of results scoped to the selected computer. Personal Remote Agents can
find and request session history under the existing owner access settings.

Queued local Wakes use refreshed working-folder information after a Service
connection refresh, while retaining the existing authorization checks.
