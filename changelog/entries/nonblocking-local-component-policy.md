---
id: nonblocking-local-component-policy
title: Keep Service readiness responsive during release refreshes
kind: fixed
areas: ["local-service", "wake"]
audiences: ["users", "operators"]
---

Service readiness queries use a verified release policy while it remains valid,
with refreshes running in the background. Slow optional download-channel reads
no longer delay required-policy checks. New Wakes remain blocked when no valid
policy is available, and repeated read failures cannot keep an expired policy
in use.
