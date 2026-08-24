---
id: protect-local-openmeld-sign-ins
title: Protect local OpenMeld sign-ins
kind: security
areas: ["authentication", "cli", "macos"]
audiences: ["users"]
---

OpenMeld now keeps its internal macOS Keychain access private to OpenMeld,
clears unreadable local sign-in state on sign-out, and remembers older
credentials that still need cleanup. npm and packaged CLI users also see
storage guidance that matches what their installation can actually do.
