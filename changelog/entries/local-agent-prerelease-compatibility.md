---
id: local-agent-prerelease-compatibility
title: Continue Codex conversations with compatible preview builds
kind: fixed
areas: ["agents"]
audiences: ["users"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1452", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "workflow:37044018284"]
---

Compatible Codex preview builds can continue existing conversations without
being incorrectly blocked by a tool-policy error. Local Agent capability checks,
model compatibility, and update advice now share semantic version handling,
including preview and build suffixes. Existing permission checks remain in place.
