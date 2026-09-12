---
id: people-center-agent-loading
title: Show the Center Agent without waiting for Agent status
kind: fixed
areas: ["web", "agents"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

The Center Agent entry uses the member and Agent identity data already
loaded by the page. Displaying its name and avatar no longer starts another
organization-wide Agent status read or waits for that read to finish.
