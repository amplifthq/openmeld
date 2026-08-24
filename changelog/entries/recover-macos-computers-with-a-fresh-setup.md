---
id: recover-macos-computers-with-a-fresh-setup
title: Recover a Mac with a fresh setup command
kind: fixed
areas: ["computers", "cli", "service"]
audiences: ["members", "admins"]
---

Fresh setup commands on supported Macs now use the normal macOS Keychain
without requiring a restricted app entitlement. If Keychain is temporarily
unavailable or does not answer within five seconds, OpenMeld stops waiting,
clearly warns the user, keeps the session in private local storage, and finishes
reconnecting the computer. It does not keep retrying Keychain in the same
process. A later successful setup or login automatically moves the session back
to Keychain. OpenMeld Service also reuses its loaded session instead of
repeatedly querying secure storage while it is running.
