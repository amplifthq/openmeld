---
id: development-workflow-errors-and-catalog-formatting
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1458","commit:f75bb375a68dcb3a35b475b6fa89e07141b1396d"]
title: Preserve development Service errors and format catalog proposals
kind: fixed
areas: ["development", "models"]
audiences: ["contributors"]
---

Stopping or uninstalling a development Service now preserves its error output
and exit status. Automated model catalog proposals use the repository formatter
before committing generated files, avoiding formatting failures at review time.
