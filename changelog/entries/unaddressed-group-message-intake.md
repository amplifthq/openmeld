---
id: unaddressed-group-message-intake
title: Let the Center Agent follow group conversations
kind: new
areas: ["channels", "center-agent"]
audiences: ["admins", "operators"]
---

The Center Agent can now take in every message in a Feishu group or Slack
channel where OpenMeld is installed, not only the ones that mention it. It
groups a burst of messages into one input, starts work only when the messages
contain a request, and stays silent for ordinary conversation. This is off by
default. To use it, an operator turns on unaddressed intake, and a Slack app
must also subscribe to the `message.channels` and `message.groups` events.
