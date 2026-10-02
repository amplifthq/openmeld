---
id: agent-avatars-return-to-rest
publishedAt: 2026-10-02
evidence: ["pr:1435", "pr:1437", "commit:7e47df194953a591cf5d2347bdb302d3ab12dd92", "commit:9eecb65683acb67422aa347f48b836b4912c02f2"]
title: Agent avatars return to rest
kind: fixed
areas: ["web", "agents", "spaces"]
audiences: ["users"]
---

Agent avatars return to their initial appearance when work ends instead of
freezing mid-animation. Animated Center Agent avatars also have room to move
without their shape being clipped by the avatar frame.
