---
id: recover-macos-computers-with-a-fresh-setup
title: Recover a Mac with a fresh setup command
kind: fixed
areas: ["computers", "cli", "service"]
audiences: ["members", "admins"]
---

Fresh setup commands on supported Macs now save the OpenMeld sign-in in modern
macOS secure storage, so a damaged legacy login Keychain no longer blocks the
computer from reconnecting. OpenMeld Service also reuses its loaded session
instead of repeatedly querying secure storage while it is running.
