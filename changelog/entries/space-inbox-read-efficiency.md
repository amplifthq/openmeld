---
id: space-inbox-read-efficiency
title: More reliable Space return visits and lighter Inbox reads
kind: improved
areas: ["spaces", "inbox"]
audiences: ["users"]
---

Spaces keep their recovered message position when you leave and return, avoiding
repeated catch-up failures. Opening a Space combines its access and membership
reads. Inbox reuses current Agent ownership checks within each feed request,
reducing repeated database work while keeping permissions, counts, and bulk
actions consistent.
