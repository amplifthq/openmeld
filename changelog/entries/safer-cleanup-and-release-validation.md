---
id: safer-cleanup-and-release-validation
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
