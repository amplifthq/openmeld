---
id: preserve-staged-service-release-projection
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1569", "commit:035a8ab5ff529464aa22550ded1775160c4e1d07", "worker-version:5b8476d9-feaf-4b8c-88a5-d5d8c5b7a30d"]
title: Keep staged Service releases on the published CLI version
kind: fixed
areas: ["release"]
audiences: ["operators"]
---

Combined Remote Agent and Local Service releases keep Core's version declaration
on the published CLI until the new CLI artifacts are available. Operators can
complete the PostgreSQL cloud stage locally and then use GitHub's signed CLI
publication workflow.
