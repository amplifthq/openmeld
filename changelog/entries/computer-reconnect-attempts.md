---
id: computer-reconnect-attempts
title: More consistent Computer reconnection
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
---

After a Computer reconnects successfully, a later interruption starts with the
normal short retry delay instead of carrying over failures from an earlier
outage. Local status stops reporting an interrupted connection as online.

Local diagnostic records connect each outage with its recovery attempts and
completion time. They remain available while offline and no longer describe
successful connections or authentication problems as network disconnects.
