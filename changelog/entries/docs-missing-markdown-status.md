---
id: docs-missing-markdown-status
title: Missing Markdown documentation returns 404
kind: fixed
areas: ["docs"]
audiences: ["developers"]
publishedAt: 2026-10-14
evidence: ["pr:1712", "workflow:38587733241"]
---

Requests for missing Markdown documentation return HTTP 404 instead of a
successful response. This also applies when a tool requests Markdown through
the Accept header, so readers and agents can detect a missing page reliably.
