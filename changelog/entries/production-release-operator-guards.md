---
id: production-release-operator-guards
title: Clearer production release controls
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Production releases preserve queued component jobs and block dependents when
a selected dependency does not succeed. Production credentials are limited to
release steps, and CLI helper builds and installation checks use trusted control
scripts.

CLI and Service publication requires GitHub. Automatic scope selection warns
when a migration would run without a Core release. The operator guide includes
commands for common releases and Worker recovery.
