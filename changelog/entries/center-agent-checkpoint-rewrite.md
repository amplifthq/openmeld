---
id: center-agent-checkpoint-rewrite
title: More reliable summaries in long Center Agent conversations
kind: fixed
areas: ["center-agent"]
audiences: ["users"]
publishedAt: 2026-10-13
evidence: ["pr:1706", "commit:9213ea6b5544d5309c9d6872dd2bc85f9b56b35a", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40"]
---

The Center Agent condenses older summaries around current requirements, confirmed
results, and remaining work. This reduces interruptions caused by repeatedly
copying long histories into a summary, while preserving the original conversation
and references to completed work.
