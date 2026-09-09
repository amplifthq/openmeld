---
id: recover-slack-mention-rich-context
title: Keep Slack mentions connected to shared context
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["members"]
publishedAt: 2026-09-08
release: v0.3.174
evidence: ["pr:747", "pr:759", "workflow:34213867447", "commit:db625a228bbdf18cb5b0a7caec3a1cb498877c65"]
---

Slack mentions recover message text, attachment details, and referenced messages
from the same channel, including replies in threads. Working status appears
before these lookups. When Slack cannot provide part of that context, the
Center Agent receives a clear limitation instead of treating the context as
complete.
