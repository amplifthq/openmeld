---
id: local-development-memory-warning
title: Start local development under stable memory warnings
kind: improved
areas: ["development"]
audiences: ["contributors"]
---

Local Worker, Web and Desktop environments can start during a macOS memory
warning after a quiet observation period, when sufficient memory remains.
Startup stays sequential under warning, and critical pressure continues to
block new work. Waiting messages explain the condition holding up startup.
Broad builds still wait for normal memory pressure.
