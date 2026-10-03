---
id: safer-cleanup-and-release-validation
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1462","workflow:37111095247","workflow:37111856220"]
title: Safer workspace cleanup and release validation
kind: fixed
areas: ["development", "releases"]
audiences: ["contributors", "operators"]
---

Development cleanup preserves nested registered workspaces instead of deleting
their local files with a parent directory. Core deployments check that the
release source's database migrations have completed before changing production.
Focused validation runs selected unit and integration tests with their owning
configurations and reports an error when a selected file cannot be run.
