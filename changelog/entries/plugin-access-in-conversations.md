---
id: plugin-access-in-conversations
title: Connect Plugins and review Agent access in a conversation
kind: improved
areas: ["plugins", "agents"]
audiences: ["members", "admins"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:493801bd981f9ecdd1d945e3c18dca009ad962ee", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

When an Agent needs a Plugin account or permission, you can open the existing
connection and access controls from its message. Save the access you choose,
then continue the original task there. New connections grant no Agent access
until you approve it.

Slack joins the featured Plugin catalog. Slack, Lark, and Feishu use the live
OpenConnector configuration for sign-in readiness. A missing OAuth client now
shows a clear setup message instead of offering a connection that cannot start.
