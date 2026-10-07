---
id: preserve-staged-service-release-projection
title: Keep staged Service releases on the published CLI version
kind: fixed
areas: ["release"]
audiences: ["operators"]
---

Combined Remote Agent and Local Service releases keep Core's version declaration
on the published CLI until the new CLI artifacts are available. Operators can
complete the PostgreSQL cloud stage locally and then use GitHub's signed CLI
publication workflow.
