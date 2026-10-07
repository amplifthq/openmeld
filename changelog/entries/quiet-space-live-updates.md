---
id: quiet-space-live-updates
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1533","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
title: Quieter Space recovery
kind: improved
areas: ["spaces"]
audiences: ["users"]
---

Space titles no longer show loading, reconnecting, or syncing badges. Brief
interruptions recover quietly. If updates remain interrupted, a discreet notice
in the conversation explains that messages and activity may be out of date and
offers Retry. Existing messages and drafts stay in place.

Live Agent work also stays visible while the same conversation reconnects.
Thinking and progress recover independently, and returning to a suspended tab
checks the connection before replacing it.
