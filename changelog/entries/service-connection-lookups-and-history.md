---
id: service-connection-lookups-and-history
title: Keep Computer connection checks responsive during release-policy refresh
kind: fixed
areas: ["computers", "agents"]
audiences: ["users", "integrators"]
publishedAt: 2026-11-01
release: v0.3.284
evidence: ["pr:349", "workflow:41280870650", "workflow:41282523330"]
---

OpenMeld can report a registered Service and its Agent routes while the release
policy is still loading. The Service keeps pending connection history on the
computer when its connection closes and resumes uploads after the new connection
is acknowledged.
