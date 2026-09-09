---
id: batch-agent-identity-reads
title: Reduce repeated Agent identity checks
kind: improved
areas: ["agents", "spaces"]
audiences: ["users"]
---

Computer synchronization and Space member name updates now read Profile
information in batches, reducing repeated requests. Temporary lookup failures
preserve existing computer routes and member names. Identity and permission
checks remain in place.
