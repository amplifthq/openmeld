---
id: ai-usage-tab-performance
title: Smoother AI usage tabs
kind: improved
areas: ["settings", "web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Switching between Organization usage and My agents now reuses the usage charts
instead of rebuilding them. Your selected period and expanded details stay in
place while each view loads its own data.
