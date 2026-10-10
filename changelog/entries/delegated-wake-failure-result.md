---
id: delegated-wake-failure-result
title: Report failures before delegated work starts
kind: fixed
areas: ["agents", "center-agent"]
audiences: ["members"]
---

When a delegated Wake fails before execution starts, its task now receives the
saved Space result. Center Agent can continue with that failure instead of
waiting for an execution that never started. Recovery keeps existing successful
or stopped results.
