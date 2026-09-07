---
id: slack-agent-connection-permission
publishedAt: 2026-09-06
evidence: ["pr:689", "pr:693", "commit:5bffe90ba001eec03f043797a61940fc922d9e06"]
title: Connect Slack with Agent status support
kind: improved
areas: ["channels", "center-agent"]
audiences: ["admins", "members"]
---

Connecting Slack now requests the permission needed to show the Center Agent's
working status in threads. Existing Slack apps can enable the Agent experience
and grant the added permission without creating a replacement app.
