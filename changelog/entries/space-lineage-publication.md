---
id: space-lineage-publication
title: Prevent concurrent profile reads from stalling Space messages
kind: fixed
areas: ["spaces", "core"]
audiences: ["members", "operators"]
---

A Space can publish a message while an earlier request is still checking the
same member's Profile lineage. Slow Space database transaction logs also show
which part of the transaction is waiting and which background alarm step ran it.
