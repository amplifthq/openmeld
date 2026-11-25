---
id: inbox-expired-snapshot-refresh
title: Explain an expired Inbox separately from a failed refresh
kind: fixed
areas: ["inbox"]
audiences: ["members"]
publishedAt: 2026-11-03
evidence: ["pr:366", "workflow:41598146737"]
---

An Inbox whose saved view has expired now says so and offers one Refresh.
That refresh loads a new view, and open groups use the new view instead of
retrying the expired one. A refresh that actually fails still says it could
not refresh.
