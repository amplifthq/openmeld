---
id: desktop-update-failure-details
publishedAt: 2026-10-07
release: v0.3.247
title: Keep Desktop update failure details
kind: improved
areas: ["desktop"]
audiences: ["users", "support"]
evidence: ["pr:1558", "pr:1568", "desktop-candidate:383cf7a1c0108015a095bfb2154da79d19b17973705909b10ff18569b226427d", "workflow:37603249378"]
---

Desktop keeps a bounded local record of the latest update failure. Check for
Updates can reveal this record after a restart or a successful retry. Records
include the update stage, versions, native error code, and HTTP status when
available. They exclude raw URLs, credentials, paths, and response bodies.
