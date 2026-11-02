---
id: space-input-gate-diagnostics
title: Trace slow Space message submissions before a reset
kind: improved
areas: ["spaces", "engineering"]
audiences: ["contributors"]
---

Operators investigating a slow Space message can see which operation held the
input gate, whether it recorded the message, and which delivery or database
steps were still pending before a timeout.
