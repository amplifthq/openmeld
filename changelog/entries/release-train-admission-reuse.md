---
id: release-train-admission-reuse
title: Avoid repeated artifact builds in coordinated releases
kind: improved
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Coordinated GitHub releases check the complete declared artifact train once,
then verify that evidence in each component job. Web deployment restores and
checks the same admitted build. Missing or mismatched evidence stops the release;
independent component releases keep their complete artifact checks.
