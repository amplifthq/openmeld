---
id: runtime-transport-gate-diagnostics
title: Trace incomplete runtime initialization and registration stages
kind: improved
areas: ["operations", "runtime"]
audiences: ["operators"]
---

Runtime Transport logs identify the active initialization or Service-registration
stage before it waits for a dependency. Operators can correlate unfinished
stages with Durable Object resets without collecting message contents or
credentials. These diagnostics do not change runtime deadlines or readiness.
