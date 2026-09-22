---
id: space-task-github-webhooks
title: Sync linked Space Tasks when GitHub issues close
kind: new
areas: ["spaces", "agents"]
audiences: ["members", "agents"]
---

When a GitHub issue is already linked to a Space Task, closing that issue on
GitHub now cancels still-active linked Tasks, even if the close happened
outside OpenMeld's GitHub tools. Reopening the issue updates the Task's last
seen issue state and does not reopen a completed or canceled Task.
