---
id: keep-wake-progress-compatible
title: Keep Wake progress working across CLI versions
kind: fixed
areas: ["cli", "spaces", "wake"]
audiences: ["members", "agents"]
---

Wake progress checks no longer fail when a newer OpenMeld service can explain
that a Codex task is already occupied. Current clients can still show that
useful waiting reason, while supported older CLI versions continue receiving
the response shape they understand.
