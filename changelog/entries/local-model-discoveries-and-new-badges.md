---
id: local-model-discoveries-and-new-badges
title: Find new models when configuring local Agents
kind: improved
publishedAt: 2026-09-05
release: v0.3.160
evidence: ["pr:681", "pr:682", "commit:36167456e3b8808331ef5d41c0807a3fd45c8b8d", "workflow:33972709677", "https://github.com/amplifthq/openmeld/pull/681#issuecomment-5553165264"]
areas: ["agent-profiles"]
audiences: ["users"]
---

Local Agent model selectors show a small New badge beside newly added options,
including GPT-6 Astra, Claude Fable 5.1 and supported Cursor and OpenCode models.
The badge also appears on the selected model when creating or editing a Profile.

Codex keeps GPT-5.6 Sol with High reasoning as its new-Profile recommendation.
Claude recommends Opus 5 with model-default reasoning. Existing explicit model
selections and remembered creation preferences are preserved; Claude Profiles
that rely on the runtime default use Opus 5 instead of Opus 4.8.
