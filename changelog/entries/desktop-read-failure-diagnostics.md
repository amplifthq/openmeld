---
id: desktop-read-failure-diagnostics
title: Retain useful diagnostics for Desktop data loading failures
kind: improved
areas: ["desktop", "diagnostics"]
audiences: ["users", "contributors"]
---

Desktop retains a small private transport log with failed interfaces, HTTP status,
request IDs, connection events, and build information. It excludes credentials,
message content, and raw URLs, helping distinguish network and authentication
failures without resetting the app or assuming the updater caused them.
