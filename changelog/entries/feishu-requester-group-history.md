---
id: feishu-requester-group-history
title: Recall your earlier Feishu group messages
kind: new
areas: ["channels", "center-agent"]
audiences: ["users", "admins"]
publishedAt: 2026-11-05
evidence: ["pr:377","pr:378","commit:d22537bc2ce313d33386ad9910c2b01b477b9818","workflow:41961130085"]
---

Organization admins can enable history for selected groups in the Feishu Channel settings. When asked about a previous discussion, the Center Agent can look back up to two hours for the requester's own top-level messages in that group. For a recap, it can say how far back it checked and whether a rate limit, missing content, or a size limit left gaps. New Feishu bots request the group-history permission by default, with a messaging-only option. Admins can update an existing bot’s permissions from the selected group’s settings and keep the same bot.
