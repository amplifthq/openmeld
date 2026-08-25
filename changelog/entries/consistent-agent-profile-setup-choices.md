---
id: consistent-agent-profile-setup-choices
title: Keep Agent setup choices consistent everywhere
kind: improved
areas: ["agents", "center-agent", "cli", "web", "projects"]
audiences: ["members"]
---

Web, the CLI, Local Agents, and the Center Agent now use the same Agent Profile
setup choices for Project, model, reasoning effort, collaboration mode, and
permissions. After a successful setup, the next Agent starts from the same
saved choices on every surface. Project folders remain private to each
computer's existing Local Project Connection. The Center Agent now sends those
choices through the same creation request and can create a working Agent
without forcing it into a Space when the task does not need one.
