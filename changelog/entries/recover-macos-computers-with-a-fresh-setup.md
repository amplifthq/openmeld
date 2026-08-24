---
id: recover-macos-computers-with-a-fresh-setup
title: Recover a Mac with a fresh setup command
kind: fixed
areas: ["computers", "cli", "service"]
audiences: ["members", "admins"]
publishedAt: 2026-08-24
release: v0.3.95
evidence: ["pr:218", "pr:219", "commit:18f0b1c004955828f9d7cc64c122b0588a235d1b", "workflow:32727645216"]
---

Fresh setup commands on supported Macs now use the normal macOS Keychain
without requiring a restricted app entitlement. If Keychain is temporarily
unavailable or does not answer within five seconds, OpenMeld stops waiting,
clearly warns the user, keeps the session in private local storage, and finishes
reconnecting the computer. It does not keep retrying Keychain in the same
process. A later successful setup or login automatically moves the session back
to Keychain. OpenMeld Service also reuses its loaded session instead of
repeatedly querying secure storage while it is running.
