---
id: automatic-wake-failure-discovery
title: Investigate Wake failures without a manual report
kind: improved
areas: ["diagnostics", "agents"]
audiences: ["operators"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891", "workflow:34522614437", "workflow:34523312980", "workflow:34525506615"]
---

Developers can list and group automatically recorded Wake failures, including
reply publication failures, without asking users to send a report. Repeated
callbacks do not create duplicate records, and expected waiting is excluded.
Remote Agent completion diagnostics help distinguish empty model output from
tool use, output limits, and provider errors without logging response content.
