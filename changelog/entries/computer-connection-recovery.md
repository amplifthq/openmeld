---
id: computer-connection-recovery
title: Clearer computer status and setup retries
kind: fixed
publishedAt: 2026-09-05
release: v0.3.160
evidence: ["pr:681", "pr:682", "commit:36167456e3b8808331ef5d41c0807a3fd45c8b8d", "workflow:33972709677", "https://github.com/amplifthq/openmeld/pull/681#issuecomment-5553165264"]
areas: ["web", "cli"]
audiences: ["users"]
---

Disconnected computers no longer make every local Agent look broken. Agent
cards show when the computer is disconnected or its status is being checked,
while preserving your saved on/off settings.

Canceling an account switch leaves the existing computer account unchanged and
updates the setup page. If computer authorization fails, the CLI explains how
to get a new command, and Web offers a fresh attempt without a page reload.
