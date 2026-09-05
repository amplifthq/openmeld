---
id: independent-computer-maintenance
title: Keep computer updates running independently
kind: improved
areas: ["cli", "openmeld-service"]
audiences: ["users"]
---

Background maintenance can check for updates even when the main OpenMeld Service
cannot start. Manual and automatic requests share one update operation, and the
maintenance process keeps a stable startup location across updates.

On Windows, OpenMeld runs through Task Scheduler in your signed-in account,
with access to your local agents and projects. New installations do not need an
administrator account or a stored Windows password. An older system-service
registration may need administrator assistance for its one-time migration.
