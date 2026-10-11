---
id: delegated-wake-failure-result
title: Report failures before delegated work starts
kind: fixed
areas: ["agents", "center-agent"]
audiences: ["members"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:815a13beff8e9b09a6d020924c1838e791ea6283", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

When a delegated Wake fails before execution starts, its task now receives the
saved Space result. Center Agent can continue with that failure instead of
waiting for an execution that never started. Recovery keeps existing successful
or stopped results.
