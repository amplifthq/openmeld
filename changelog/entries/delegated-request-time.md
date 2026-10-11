---
id: delegated-request-time
title: Keep the original time for delegated requests
kind: fixed
areas: ["center-agent"]
audiences: ["members"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:02ae082c1b6fa063467d7c74841a015a5f538537", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800", "workflow:38077171997"]
---

Delegated tasks and follow-up work keep the original request's time and timezone.
Relative instructions such as "in ten minutes" use the same starting time after
a task completes or its follow-up request retries.
Local Agents also receive this time reference when their work starts later.
