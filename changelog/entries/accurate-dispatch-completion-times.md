---
id: accurate-dispatch-completion-times
title: Keep Center Agent completion times accurate
kind: fixed
areas: ["center-agent", "diagnostics", "performance"]
audiences: ["members", "admins"]
publishedAt: 2026-08-26
evidence: ["pr:333", "commit:634fd463fff620b54d42ccceab92be65fdab971e", "worker-version:928e7144-6168-4785-9076-f16a1ade7a0d", "center-agent-dispatch:84093d46-8a78-4d87-921f-6e28dfa9e239"]
---

Center Agent diagnostics now keep the time a task first completed when a final
confirmation is safely replayed. Repeated confirmations no longer make a
completed task look slower than it was.
