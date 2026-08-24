---
id: keep-codex-permissions-stable
title: Keep Codex permissions stable during background checks
kind: fixed
areas: ["agent-profiles", "service"]
audiences: ["members"]
publishedAt: 2026-08-24
release: v0.3.88
evidence: ["pr:195", "commit:11f10b4061748c25e5a60149dfb09ced9eba4886", "workflow:32694470317"]
---

OpenMeld no longer changes a Codex conversation's approval or sandbox settings
while checking it in the background or recovering an interrupted task. Your
selected Agent Controller Permission Mode now remains in effect for later work.
