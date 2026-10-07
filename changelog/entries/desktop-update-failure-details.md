---
id: desktop-update-failure-details
title: Keep Desktop update failure details
kind: improved
areas: ["desktop"]
audiences: ["users", "support"]
evidence: ["pr:1558"]
---

Desktop keeps a bounded local record of the latest update failure. Check for
Updates can reveal this record after a restart or a successful retry. Records
include the update stage, versions, native error code, and HTTP status when
available. They exclude raw URLs, credentials, paths, and response bodies.
