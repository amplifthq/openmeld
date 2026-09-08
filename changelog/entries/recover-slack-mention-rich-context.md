---
id: recover-slack-mention-rich-context
title: Keep Slack mentions connected to shared context
kind: fixed
areas: ["channels", "center-agent"]
audiences: ["members"]
---

Slack mentions now recover attached files and referenced Slack messages before
the Center Agent starts. When Slack cannot provide part of that context, the
Center Agent receives a clear limitation instead of treating the context as
complete.
