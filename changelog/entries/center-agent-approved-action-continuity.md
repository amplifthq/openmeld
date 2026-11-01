---
id: center-agent-approved-action-continuity
title: Keep approved issue actions and Space conversations on track
kind: fixed
areas: ["center-agent", "spaces", "plugins"]
audiences: ["members"]
publishedAt: 2026-10-28
evidence:
  - "pr:322"
  - "commit:e81bffebaf37b6df298bec9c379351fabd0a8ba6"
  - "workflow:40707461284"
  - "workflow:40712223521"
---

Approving a Center Agent request to create a Linear or GitHub issue resumes the
saved operation with its original content and account. The Agent no longer has
to reconstruct the issue description from conversation history.

Independent requests in ordinary Space threads keep separate conversation
history, so a request in another thread cannot replace the context of an
approval. Center Agent Direct Messages retain their existing continuity.
