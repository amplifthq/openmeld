---
id: agent-logo-hidden-sidebar
title: Keep Agent logos visible when the sidebar is closed
kind: fixed
areas: ["spaces", "web"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Codex logos in Space cards no longer turn into blank white tiles when the
sidebar is closed. Repeated Agent logos now keep their own color definitions,
so hiding one copy does not affect another.
