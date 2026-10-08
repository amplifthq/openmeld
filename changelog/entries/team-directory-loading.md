---
id: team-directory-loading
title: Less repeated work when browsing Team
kind: improved
areas: ["web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Team tabs begin loading when you point to them or reach them with the keyboard.
Profile avatars reuse their rendered backgrounds when you move between pages,
reducing repeated drawing in member lists and cards.
