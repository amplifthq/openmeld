---
id: model-catalog-update-handoffs
title: Prepare model updates for review automatically
kind: improved
areas: ["agent-profiles", "developer-workflow"]
audiences: ["contributors"]
publishedAt: 2026-09-05
release: v0.3.158
evidence: ["pr:656", "pr:658", "commit:8b98ac0d0882e70a00f5f3eb6b7f818073a27254"]
---

A twice-daily collector prepares model-update pull requests with official source
evidence and clear decisions for the reviewing coding agent. Confirmed Codex
catalog additions are prepared automatically; account access and product defaults
remain explicit review decisions.

New Agent Profile recommendations can be configured independently of runtime
defaults, while preserving existing selections and remembered preferences.
