---
id: windows-service-task-readback
title: Fix Windows Service setup after task registration
kind: fixed
areas: ["cli", "setup", "windows"]
audiences: ["users", "contributors"]
---

Windows setup no longer rejects a Service task immediately after registering
it because installation metadata leaked into its launch command. The same
correction covers the automatic maintenance task.

Existing tasks written with that metadata remain readable, so normal setup and
repair can proceed without deleting local data or manually replacing tasks.
Task identity, permissions, working directory, and console-free hosting are
unchanged. Validation now covers real Service installation and task readback,
as well as the maintenance command producer and previously stored payloads.
