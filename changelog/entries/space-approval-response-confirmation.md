---
id: space-approval-response-confirmation
title: Confirm Agent responses after a connection timeout
kind: fixed
areas: ["spaces", "agents"]
audiences: ["members"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Space approvals and answers now check whether a response was saved when its
confirmation is lost. If the result remains unknown, a clear status and check
action replace the misleading failure message. Inbox updates no longer delay
sending a saved response to the Agent.
