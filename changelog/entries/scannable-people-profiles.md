---
id: scannable-people-profiles
title: Scan people and their work access at a glance
kind: improved
areas: ["people", "profiles", "computers", "channels"]
audiences: ["members", "admins"]
---

People now puts you first, shows every member's role and recent Human activity,
and aligns Computer and connected-identity status in one consistent card
footer. Selecting any non-action area of a member card opens a focused profile
drawer with account, access, Channel, and management details without crowding
the directory, while buttons and links keep their own behavior. Connected Slack
accounts show the exact account email returned by Slack instead of substituting
a display name. When your Organization Channel is ready but your own account is
not linked, your card now offers **Connect Slack**, **Connect Lark**, or
**Connect Feishu** and opens the secure account-proof flow directly. The drawer
also shows the member's Agent Profile count and icons, and its colored Computer
status row opens the relevant Computer detail. Members can edit their own
profile name directly in that drawer without opening another dialog. An
existing Profile Report remains available while **Learn about** can run again
from either the member card or profile drawer to create an updated report.
After a Slack account handoff completes, the success card now opens the exact
originating Slack thread instead of leaving the member at a dead end.
The same Organization directory activity is available to the Center Agent and
to local agents through `openmeld org directory --view agent`, while Computer
heartbeats, login refreshes, and coding Agent Activity never impersonate Human
activity.
