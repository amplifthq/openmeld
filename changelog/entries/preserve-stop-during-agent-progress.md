---
id: preserve-stop-during-agent-progress
title: Keep Stop available while agents work
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.201
evidence: ["pr:969", "pr:980", "commit:a4521fb2865759abbd715be2cab5aa8d41a90b63", "workflow:34738376199"]
---

Thinking and reply preview updates no longer remove an available Stop button
from an active Wake. This applies to the shared conversation controls used in
direct messages, group conversations, and threads.
