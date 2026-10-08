---
id: agent-tool-context-recovery
title: Less repeated setup during Agent work
kind: improved
areas: ["center-agent"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Hosted Agents can recover recently selected tools across multiple steps after
context compaction. Clearer guidance helps them reuse existing evidence and
continue pending work. Directory reads with only a new response timestamp no
longer count as new information for repeated-read protection.
