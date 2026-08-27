---
id: recover-interrupted-center-agent-wakes
title: Recover interrupted Center Agent Wakes
kind: fixed
areas: ["center-agent", "spaces", "wake"]
audiences: ["members"]
---

OpenMeld now resumes the same Center Agent Wake when a service interruption
happens before the remote runtime accepts it. The Space keeps showing the
Core-owned Wake state until a real final outcome exists, and diagnostics remain
available even when no remote conversation was created.
