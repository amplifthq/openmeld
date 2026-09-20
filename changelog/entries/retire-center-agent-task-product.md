---
id: retire-center-agent-task-product
title: Retire the separate Center Agent Task workspace
kind: removed
areas: ["center-agent"]
audiences: ["users", "developers"]
publishedAt: 2026-09-08
release: v0.3.174
evidence: ["pr:734", "pr:759", "workflow:34213867447", "commit:db625a228bbdf18cb5b0a7caec3a1cb498877c65"]
---

Center Agent work continues in chat sessions. The separate Task board, Task
pages, creation and query tools, APIs, and Task Inbox updates are removed.
Local Agent execution handles, stopping, waiting, and result callbacks remain
available. Existing chat messages remain readable.
