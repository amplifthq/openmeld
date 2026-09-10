---
id: automatic-wake-failure-discovery
title: Investigate Wake failures without a manual report
kind: improved
areas: ["diagnostics", "agents"]
audiences: ["operators"]
---

Developers can list and group automatically recorded Wake failures, including
reply publication failures, without asking users to send a report. Repeated
callbacks do not create duplicate records, and expected waiting is excluded.
Remote Agent completion diagnostics help distinguish empty model output from
tool use, output limits, and provider errors without logging response content.
