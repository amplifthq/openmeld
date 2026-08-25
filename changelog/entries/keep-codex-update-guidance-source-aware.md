---
id: keep-codex-update-guidance-source-aware
title: Keep Codex update guidance tied to its installation
kind: fixed
areas: ["computers", "local-agents"]
audiences: ["members"]
publishedAt: 2026-08-25
evidence: ["pr:248", "pr:250", "commit:d178ec59a0a74555fc897b0d16623a1a62cb93d2", "workflow:32805444531", "workflow:32806735335"]
---

OpenMeld no longer compares the Codex included with the ChatGPT app against the
standalone Codex CLI release. ChatGPT app installations stay under the app's
own update channel, while npm and Homebrew installations continue to use their
matching package channels. Codex usage details also put the overall weekly
limit first and use a lighter circular gauge.
