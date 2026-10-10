---
id: customer-content-diagnostics-privacy
title: Keep customer conversations out of routine diagnostics
kind: security
areas: ["privacy", "center-agent", "diagnostics"]
audiences: ["members", "admins", "operators"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:afc9cb1bbb1b862534c1492b8da32c5e1687b2be", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

For customer organizations in production, model logs keep usage and status
information without a copy of the conversation. Automatic agent feedback sends
problem categories and diagnostic IDs instead of generated summaries or details.
User-submitted feedback still includes the information you choose to share.

Diagnostic Report IDs resolve through the current database to compact execution
traces. Authorized infrastructure operators can still investigate stored content
with your consent. Task execution and conversation history remain available.
