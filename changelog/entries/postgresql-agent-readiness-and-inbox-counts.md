---
id: postgresql-agent-readiness-and-inbox-counts
title: Faster Agent availability and Inbox counts
kind: improved
areas: ["agents", "organizations", "inbox"]
audiences: ["users"]
---

Team Agent availability and Inbox counts load with less database work. Agent
availability keeps its current identity, provider, and organization checks.
Inbox counts keep unread items and open requests while skipping read history
that no longer needs attention.
