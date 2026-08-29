---
id: reliable-cli-multi-file-messages
title: Send multiple files reliably from the CLI
kind: fixed
areas: ["spaces", "files", "cli"]
audiences: ["members", "agents"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:472", "commit:beb7b690e3d1d3fcdc3e5984f4155252ca06fc06", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:acb7e69e-ffed-4ef2-96e7-c734a2598961"]
---

CLI users and Local Agents can share up to ten files in one Space message
without the second upload colliding with the first. If a later upload fails,
OpenMeld moves files already added by that send to recoverable Trash and gives
exact cleanup guidance if any file could not be moved. CLI help and the official
OpenMeld Skill now consistently use `--file` for shared files and `--text-file`
for a UTF-8 message body.
