---
id: cloud-resource-billing-safeguards
title: Reduce idle cloud usage and repeated recovery requests
kind: improved
areas: ["computer", "channels", "downloads"]
audiences: ["admins", "developers"]
---

Idle cloud Computers release their runtime connections after work and file
synchronization finish. Unfinished or uncertain commands keep their runtime.
Background Git imports keep the Computer active until their command finishes.
Long file transfers also keep their connection active until the operation ends.
Slack recovery slows down during a prolonged outage without discarding messages.
Public reads and CLI downloads have request limits, and CLI releases use edge
caching to reduce repeated storage reads.
Web-proxied public reads preserve the visitor IP for Gateway request limits.
