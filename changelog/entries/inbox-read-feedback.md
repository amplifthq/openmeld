---
id: inbox-read-feedback
title: Clear Inbox requests with less effort
kind: improved
areas: ["inbox"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Ended Agent approval, plan review, and question requests no longer leave an
unread dot or ask for a response. Their history stays available. Failure notices
and final results stay unread until you read them.

Mark as read responds immediately for individual items and groups. Individual
items now show the action beside the three-dot menu. If saving fails, Inbox
restores the affected read state without undoing other successful reads.
