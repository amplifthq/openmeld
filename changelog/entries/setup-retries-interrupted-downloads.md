---
id: setup-retries-interrupted-downloads
title: Setup recovers from interrupted downloads
kind: fixed
areas: ["computers", "setup"]
audiences: ["members"]
publishedAt: 2026-08-28
evidence: ["pr:439", "commit:13de29ecb66e0b8a594e2b7ca7a8f5adff4d8fcc", "cloudflare:web:84b94eea-ed8c-42d0-b3a1-ff1bf632974f"]
---

Computer setup now retries a temporarily interrupted OpenMeld download inside
the same command, instead of making the user copy and run the setup command
again.
