---
id: optimistic-composer-attachments
title: Clear sent attachments from the composer immediately
kind: fixed
areas: ["spaces", "web"]
audiences: ["members"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Sending a message moves its text and attachments into the conversation immediately,
without leaving file cards or a ready-to-send count in the composer. This works
in Spaces, direct messages, and threads. Rejected messages remain recoverable,
and finishing a send does not clear attachments added to the next draft.
