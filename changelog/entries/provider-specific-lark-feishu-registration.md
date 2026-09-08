---
id: provider-specific-lark-feishu-registration
title: Keep Lark and Feishu setup tied to the selected platform
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["admins"]
---

Lark and Feishu setup now open their matching platform pages. OpenMeld keeps
the selected platform throughout registration, and
a different account brand produces a clear switch-account message with a
restart action. Pending links from the older shared entry are refreshed when
their owner resumes setup.

Already-open setup sessions can continue polling older links, and a failed
resume keeps its error visible with a Start over action for organization admins.
