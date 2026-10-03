---
id: development-workflow-errors-and-catalog-formatting
title: Preserve development Service errors and format catalog proposals
kind: fixed
areas: ["development", "models"]
audiences: ["contributors"]
---

Stopping or uninstalling a development Service now preserves its error output
and exit status. Automated model catalog proposals use the repository formatter
before committing generated files, avoiding formatting failures at review time.
