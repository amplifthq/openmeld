---
id: runtime-hub-owner-service-read-diagnostics
title: Trace individual Computer readiness lookup attempts
kind: improved
areas: ["engineering"]
audiences: ["contributors"]
---

Operators investigating a Computer readiness timeout can match each retry to
the Runtime Transport Hub that handled it and see whether the Hub read the
request body, completed the lookup, and prepared a response.
