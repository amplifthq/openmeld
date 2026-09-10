---
id: space-file-working-context
title: Keep shared working files in the conversation
kind: new
areas: ["spaces", "files", "routines"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

Agents can discover pinned working files from their Wake context and read the
current version before using it. Choose who receives a file's update notices,
or start an ordinary Routine to maintain a text file from confirmed decisions.
Notifications are off until a human chooses recipients.
