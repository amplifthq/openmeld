---
id: space-task-github-binding
title: Link Space Tasks with GitHub issues
kind: new
areas: ["spaces", "agents", "web"]
audiences: ["members", "agents"]
---

Filing a GitHub issue from a shared Space now records a linked Task. The issue
body gets an OpenMeld Task reference, and the Task shows the repository and
issue number. Closing the issue through OpenMeld's GitHub tools closes
still-active linked Tasks. Completing or canceling a Task asks you to close
the linked GitHub issue when it is still open. If the Space already has more
than 500 Tasks, OpenMeld will not guess whether that issue already has a card:
it leaves the GitHub issue as-is and says so in the tool result.
