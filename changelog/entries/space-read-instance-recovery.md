---
id: space-read-instance-recovery
title: Recover Space reads across instance updates
kind: fixed
areas: ["spaces"]
audiences: ["members"]
---

Member lists, plugin request lists, and Wake progress can now recover when a
Space instance is replaced mid-read. OpenMeld checks access again on a fresh
connection and returns the result if it arrives within the recovery window.
