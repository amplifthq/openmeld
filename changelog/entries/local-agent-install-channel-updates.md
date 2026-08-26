---
id: local-agent-install-channel-updates
title: Match local agent updates to the install you selected
kind: fixed
areas: ["cli", "openmeld-service", "computers"]
audiences: ["members"]
evidence: ["pr:336"]
---

Computers now check each local agent's selected install against that install's
own update channel. Homebrew tap installs are no longer compared with Homebrew
core, and the update command matches the selected OpenCode, Claude Code,
Cursor, Codex, or Grok Build install. OpenCode installs from the official
install script and Claude Code installs under `~/.local/bin` are now
discoverable even when those directories are not on `PATH`.
