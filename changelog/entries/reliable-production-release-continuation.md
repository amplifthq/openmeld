---
id: reliable-production-release-continuation
title: Continue production releases through required receiver updates
kind: fixed
areas: ["developer-workflow"]
audiences: ["contributors"]
---

The automatic production release command can read deployment status without
stalling during startup. Releases that need Core before CLI publication now
deploy and verify that receiver while preserving the currently published CLI,
including when another component connects the dependency.
