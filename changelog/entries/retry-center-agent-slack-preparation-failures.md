---
id: retry-center-agent-slack-preparation-failures
title: Send and safely retry Center Agent Slack messages
kind: fixed
areas: ["center-agent", "channels"]
audiences: ["members"]
---

Center Agent can send formatted Slack messages again and retry the same message
when OpenMeld fails while preparing it, before anything reaches Slack.
Genuinely uncertain Slack delivery outcomes remain safely blocked so a retry
cannot create a duplicate.
