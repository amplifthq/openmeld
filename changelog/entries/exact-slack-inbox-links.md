---
id: exact-slack-inbox-links
title: Open exact Slack messages from Inbox
kind: fixed
areas: ["inbox", "slack", "center-agent"]
audiences: ["members"]
publishedAt: 2026-08-19
evidence: ["pr:124", "commit:03339b2fad85e6bb2834ee9085ad0ddbdef59f88", "workflow:32190997197", "workflow:32197280409", "workflow:32198069001", "workflow:32198451108"]
---

Inbox now links Center Agent Slack updates to the exact Slack message. Opening
the link marks the OpenMeld item read, and temporary Slack permalink failures
are retried without creating duplicate Inbox items. Existing Slack items are
upgraded in place without resetting their read, action, or dismissal state.
Tabs left open during the rollout keep the prior Center Agent destination until
they reload the current Web client.
