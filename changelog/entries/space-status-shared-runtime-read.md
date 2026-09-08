---
id: space-status-shared-runtime-read
title: Reduce repeated checks when loading Space status
kind: improved
areas: ["spaces", "agents"]
audiences: ["users"]
---

Space status reads shared Computer information once per request instead of
repeating the same checks for every Agent. This reduces server load for Spaces
with several local Agents while preserving each Agent's readiness checks.
