---
id: remote-agent-continuous-work
title: Keep Remote Agents working through longer requests
kind: fixed
areas: ["remote-agent", "center-agent"]
audiences: ["users"]
evidence: ["pr:1104"]
---

Center and personal Remote Agents continue longer requests without stopping at
the former 64-tool boundary. Long Computer commands keep their existing command
identity while the Agent collects their results. Stop also reaches cancellable
operations inside Code Mode.

If a request reaches the execution safety limit, OpenMeld reports that it is
unfinished. Completed actions remain in place and are not automatically repeated.
