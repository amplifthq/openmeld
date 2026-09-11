---
id: space-durable-reading-positions
title: Keep Space reading positions tied to saved messages
kind: fixed
areas: ["spaces"]
audiences: ["users"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891"]
---

New reading positions saved while a reply is still arriving now stay tied to a
saved message. Returning to the Space or using Back after browsing its history
no longer tries to find that temporary reply in message history. Existing
reading positions are preserved.
