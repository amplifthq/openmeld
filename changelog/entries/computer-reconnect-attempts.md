---
id: computer-reconnect-attempts
title: More consistent Computer reconnection
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.200
evidence: ["pr:974", "pr:975", "commit:de0140fd0892ffb13fd6a670a30a5c96074b6c39", "workflow:34731853294", "smoke:recovery:35bf4c1d-4f15-4b15-88fe-704ef4fa93bd"]
---

After a Computer reconnects successfully, a later interruption starts with the
normal short retry delay instead of carrying over failures from an earlier
outage. Local status stops reporting an interrupted connection as online.

Local diagnostic records connect each outage with its recovery attempts and
completion time. They remain available while offline and no longer describe
successful connections or authentication problems as network disconnects.
