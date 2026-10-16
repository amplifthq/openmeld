---
id: faster-workspace-message-search
title: Search messages across Spaces with less waiting
kind: improved
areas: ["spaces", "web", "desktop", "agents"]
audiences: ["members"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["pr:205", "commit:e7bcf2f444662ce4acc618d32354e378ce8df3fc", "commit:9f1f6f8b4ec2f628288a77593042f33d51bf1d47", "commit:86e97740136af0f3b1ffbbb2ad2165b8892c7b5d"]
---

Message searches across many Spaces spend less time waiting for each conversation
to respond. Web, Desktop, and Agent message reads use the same improved reader,
with the existing access checks, result order, and complete pagination.
