---
id: thread-quoted-context-and-continuation
title: Keep context when replying to Agents
kind: improved
areas: ["spaces", "agents"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

Agents receive the retained message you quote, including messages outside the
recent conversation window. Recalled messages are identified without exposing
their withdrawn text. Threads suggest the Agent most recently explicitly Woken
by a human, using the existing removable recipient in the message composer.
