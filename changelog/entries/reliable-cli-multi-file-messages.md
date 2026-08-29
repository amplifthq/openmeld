---
id: reliable-cli-multi-file-messages
title: Send multiple files reliably from the CLI
kind: fixed
areas: ["spaces", "files", "cli"]
audiences: ["members", "agents"]
---

CLI users and Local Agents can share up to ten files in one Space message
without the second upload colliding with the first. If a later upload fails,
OpenMeld moves files already added by that send to recoverable Trash and gives
exact cleanup guidance if any file could not be moved. CLI help and the official
OpenMeld Skill now consistently use `--file` for shared files and `--text-file`
for a UTF-8 message body.
