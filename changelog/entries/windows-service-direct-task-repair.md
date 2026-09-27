---
id: windows-service-direct-task-repair
title: Keep Windows computer setup from removing its own Service
kind: fixed
areas: ["cli", "setup", "windows"]
audiences: ["users"]
---

Windows setup and repair recognize the current background Service task as part
of this installation. They no longer mistake its direct executable launch for
an old task and remove the Service files while preparing the connection.
