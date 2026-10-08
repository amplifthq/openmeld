---
id: inbox-filter-feedback
title: Inbox filters respond immediately
kind: improved
areas: ["inbox", "web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Inbox tabs, Unread only, and activity and conversation filters now respond
without waiting for page navigation. The selected view shows its own loading
state while new results arrive. Filter combinations and browser back and forward
continue to work, including older unread-only links.
