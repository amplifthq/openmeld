---
id: cursor-background-checks-without-keychain-prompts
title: Stop repeated macOS Keychain prompts during Cursor checks
kind: fixed
areas: ["local-agents", "cli"]
audiences: ["users"]
---

OpenMeld can check your Cursor CLI installation in the background without
asking you to unlock the macOS Keychain. If your saved credentials require
approval to read, OpenMeld reports that it could not confirm your sign-in.
