---
id: center-agent-command-sync-stop
title: Keep Stop responsive while Computer files synchronize
kind: fixed
areas: ["center-agent"]
audiences: ["users"]
---

Center Agent command polling stays bounded and responds to Stop even after a
command exits while its files are still synchronizing. A later poll can resume
without repeating output or claiming completion before synchronization finishes.
