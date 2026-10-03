---
id: native-continuation-trace
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1458","workflow:37111856220","workflow:37113245618"]
title: Trace native follow-up tasks from the CLI
kind: fixed
areas: ["cli", "agents"]
audiences: ["operators", "agents"]
---

Exact-dispatch CLI trace now reads native follow-up tasks even when they have no
workstation dispatch record. It shows execution, publication, and the final
Space message separately, and keeps saved facts visible when detailed runtime
evidence is unavailable.
