---
id: retry-center-agent-slack-preparation-failures
title: Retry Slack messages that were never sent
kind: fixed
areas: ["center-agent", "channels"]
audiences: ["members"]
---

Center Agent can retry the same Slack message when OpenMeld fails while
preparing it, before any message reaches Slack. Genuinely uncertain Slack
delivery outcomes remain safely blocked so a retry cannot create a duplicate.
