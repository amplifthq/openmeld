---
id: persistent-lark-feishu-connections
title: Connect Lark and Feishu without Webhook setup
kind: improved
areas: ["channels", "center-agent"]
audiences: ["admins", "members"]
---

New Lark and Feishu bots connect through the official persistent connection
flow, removing public Webhook verification from setup. Messages are saved
before receipt is confirmed, and interrupted connections recover automatically.
Existing Webhook bots keep working; repairing one moves the same app to the new
connection method.
