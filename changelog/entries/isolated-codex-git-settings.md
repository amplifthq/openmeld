---
id: isolated-codex-git-settings
title: Protect Git settings in isolated Codex tasks
kind: fixed
areas: ["wake"]
audiences: ["users"]
---

Isolated Codex tasks can write their own files and Git data while Git hooks and
configuration remain read-only. This also protects the private repository used
by OpenMeld, whose directory name is not covered by Codex's default `.git`
protection.
