---
id: thread-reply-user-time-context
title: Keep your time zone when replying in a thread
kind: fixed
areas: ["spaces", "center-agent"]
audiences: ["users"]
publishedAt: 2026-10-09
release: v0.3.250
evidence: ["pr:1619","commit:96cb28b5a32f3757c6fd2b78ede81044a45a5a6b","deployment:openmeld-core-prod/3086fdb3-fbad-42f9-8a7e-a3fb5b8a026c","commit:07158c4b07e9c63fbccdb5f3f9d1c09711f1a5d9"]
---

Thread replies now use your observed time zone and the time OpenMeld received
your message. Relative dates and delays keep that original time when delivery
waits or retries.
