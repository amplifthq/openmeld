---
id: project-folder-legacy-connection
title: Add a Project folder connected by an older OpenMeld CLI
kind: fixed
areas: ["agents", "projects", "cli"]
audiences: ["members"]
evidence: ["pr:277"]
---

Adding a Project as an Agent working folder no longer fails with "Connect this
Project on this computer" when the Project was connected by an older OpenMeld
CLI. Adding the folder reconnects that Project under your account, so the
Agent can then work in it. A Project folder connected under another OpenMeld
account on the same computer is still refused.
