---
id: docs-missing-markdown-status
title: Missing Markdown documentation returns 404
kind: fixed
areas: ["docs"]
audiences: ["developers"]
---

Requests for missing Markdown documentation return HTTP 404 instead of a
successful response. This also applies when a tool requests Markdown through
the Accept header, so readers and agents can detect a missing page reliably.
