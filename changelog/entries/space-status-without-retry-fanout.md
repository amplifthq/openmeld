---
id: space-status-without-retry-fanout
title: Avoid extra Agent checks when Profile reads are unavailable
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
---

When a Space's batch Profile lookup fails or times out, its status check no
longer launches another lookup for every Agent. The check reports unavailable
identity evidence and tries again on the next request, while keeping members
and their last known names. Wake admission still checks its own current facts.
