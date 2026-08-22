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
accounts show the provider name or handle together with the exact account email
when both are available, without guessing either value. Unavailable Channels
stay as quiet gray logos on the card and explain their status only in the
drawer. Existing Slack links without verified metadata can be refreshed without
disconnecting first. When your Organization Channel is ready but your own
account is not linked, its logo opens the secure account-proof flow directly.
The drawer
also gives owners and admins the provider setup entry while ordinary members
can send one deduplicated setup request to their Organization admins without
gaining Channel-management access. Admins receive the request in Inbox and it
closes automatically after the provider connects. The drawer
also shows the member's Agent Profile count and icons, links that summary to the
member's Agents, and opens the relevant Computer detail from its colored status
row. Singular and mixed Computer summaries stay concise with **Computer
connected** or **Computer offline**, while multiple online Computers retain an
exact count. Drawer values can be selected and copied. Members can edit their
own profile name directly in that drawer without opening another dialog. An
existing Profile Report remains available while **Learn about** can run again
from either the member card or profile drawer to create an updated report.
After a Slack account handoff completes, the success card now opens either the
exact originating Slack thread or the member's OpenMeld profile instead of
leaving the member at a dead end.
The same Organization directory activity is available to the Center Agent and
to local agents through `openmeld org directory --view agent`, while Computer
heartbeats, login refreshes, and coding Agent Activity never impersonate Human
activity.
