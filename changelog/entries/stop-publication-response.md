---
id: stop-publication-response
title: Report the actual result when stopping a pending reply
kind: fixed
areas: ["spaces", "wake"]
audiences: ["users"]
---

Stopping a Wake no longer reports that its state changed merely because
publishing the stopped notice takes more than one second. Concurrent Stop
requests wait for the same finalization work and report the persisted outcome.
Unavailable publication still returns a retryable failure.
