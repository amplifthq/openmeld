---
id: homebrew-cask-update-source
title: Use the correct Homebrew cask update source
kind: fixed
areas: ["cli", "local-agents"]
audiences: ["users"]
---

OpenMeld now reads the installed tap for Homebrew cask-based local agents, so
version checks and suggested upgrade commands follow the source users actually
installed.
