---
id: local-development-memory-warning
title: Start local development under stable memory warnings
kind: improved
areas: ["development"]
audiences: ["contributors"]
---

Local Worker and Web environments, and Desktop with a reusable prepared bundle,
can start during a macOS memory warning after a quiet observation period, when
sufficient memory remains. Desktop builds that need to be created or refreshed
still wait for normal memory pressure.
Startup stays sequential under warning, and critical pressure continues to
block new work. Waiting messages explain the condition holding up startup.
Broad builds still wait for normal memory pressure.
