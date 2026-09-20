---
id: codex-wake-session-titles
title: Recognizable names for new Codex sessions
kind: fixed
areas: ["agents", "local-service"]
audiences: ["members"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

New Codex sessions started by a Wake get a short name based on the Agent and
request, making them easier to find. Naming runs while the Agent works and does
not hold up the task if it fails. Existing session names stay unchanged.
