---
id: wake-stop-and-provider-failures
title: More reliable Wake stopping and clearer model errors
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

Stopping a local Wake from its message now preserves the original request identity,
so the stop request reaches the correct execution. Known model policy refusals and
invalid model or reasoning settings show a clearer explanation without exposing
private request content.
