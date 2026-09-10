---
id: complete-long-message-previews
title: Keep long message previews complete
kind: fixed
areas: ["spaces", "messages"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.193
evidence: ["pr:870", "pr:876", "commit:204b0e70b271ab69158f8e14a33d1d97b43cb880", "workflow:34434697090"]
---

Long messages now fold around 2,000 characters, finishing complete paragraphs
and Markdown blocks instead of cutting through words, lists, tables, or code.
A subtle fade marks the folded edge. Show more expands the original message
in place in Spaces, chats, and threads.
