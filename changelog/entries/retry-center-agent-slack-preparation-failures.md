---
id: retry-center-agent-slack-preparation-failures
title: Send and safely retry Center Agent Slack messages
kind: fixed
areas: ["center-agent", "channels"]
audiences: ["members"]
publishedAt: 2026-08-26
release: v0.3.115
evidence: ["pr:326", "pr:328", "pr:330", "pr:331", "commit:363fffefc2f47b0e7e17eea3475cf6790170009a", "tag:v0.3.115", "workflow:32977014291", "worker-version:b1c2ace5-51db-4cdc-a9bb-99837894b2a8", "slack-message:1787753142.488589"]
---

Center Agent can send formatted Slack messages again and retry the same message
when OpenMeld fails while preparing it, before anything reaches Slack.
Genuinely uncertain Slack delivery outcomes remain safely blocked so a retry
cannot create a duplicate.
