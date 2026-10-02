---
id: remote-agent-provider-avatars
publishedAt: 2026-10-02
evidence: ["pr:1435", "pr:1437", "commit:7e47df194953a591cf5d2347bdb302d3ab12dd92", "commit:9eecb65683acb67422aa347f48b836b4912c02f2"]
title: Recognize Remote Agents by their model provider
kind: fixed
areas: ["web", "agents", "spaces"]
audiences: ["users"]
---

Remote Agents now use their selected model provider's logo as the default avatar.
Changing models updates the default across the sidebar, messages, and profile
cards. Custom avatars keep their appearance, and Local Agents keep their coding
tool logos. Models without a supported provider logo use the neutral Agent icon.
