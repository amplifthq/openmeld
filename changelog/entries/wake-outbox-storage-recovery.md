---
id: wake-outbox-storage-recovery
title: Keep Wake requests recoverable when storage is busy
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

Temporary database overload no longer ends a Wake with an incorrect account
error. OpenMeld keeps the original request and spaces out recovery checks,
without starting duplicate recovery checks for the same Space.
