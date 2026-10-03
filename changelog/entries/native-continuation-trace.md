---
id: native-continuation-trace
title: Trace native follow-up tasks from the CLI
kind: fixed
areas: ["cli", "agents"]
audiences: ["operators", "agents"]
---

Exact-dispatch CLI trace now reads native follow-up tasks even when they have no
workstation dispatch record. It shows execution, publication, and the final
Space message separately, and keeps saved facts visible when detailed runtime
evidence is unavailable.
