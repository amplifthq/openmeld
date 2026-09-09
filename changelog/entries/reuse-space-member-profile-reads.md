---
id: reuse-space-member-profile-reads
title: Reduce repeated reads when checking Space Agents
kind: improved
areas: ["spaces", "agents"]
audiences: ["users", "operators"]
---

Space status and member lists reuse the current Profile details already read
for that request when checking whether Agents can Wake. This reduces repeated
database reads while keeping identity and ownership checks and refreshing the
facts on the next request.
