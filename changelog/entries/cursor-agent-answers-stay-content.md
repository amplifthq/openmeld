---
id: cursor-agent-answers-stay-content
title: Keep Cursor answers separate from account failures
kind: fixed
areas: ["agents", "cli"]
audiences: ["members", "admins"]
---

OpenMeld no longer turns a successful Cursor Agent answer into an account
failure because its text matches a provider upgrade notice. Cursor protocol
failures still use their structured error path, while completed Agent text
always remains the answer.
