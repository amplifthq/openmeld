---
id: keep-space-members-readable-during-hub-interruptions
title: Keep Space members readable during connection interruptions
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users", "operators"]
---

Space member lists remain available when an Agent's live connection status
cannot be checked. Status that cannot be verified is explicitly unavailable,
while other members and confirmed status remain visible.

Connection lookups can retry a stalled HTTP attempt within their existing total
time budget. Retries remain limited to supported reads and do not replay
actions or device commands.
