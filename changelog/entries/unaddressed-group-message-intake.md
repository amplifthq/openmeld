---
id: unaddressed-group-message-intake
title: Let the Center Agent follow group conversations
kind: new
areas: ["channels", "center-agent"]
audiences: ["admins", "operators"]
---

The Center Agent can now take in people's ordinary messages in a Feishu group
or Slack channel where OpenMeld is installed, not only the ones that mention
it. Messages from apps and bots, and message types it cannot read, are still
skipped. It
groups a burst of messages into one input, starts work only when the messages
contain a request, and stays silent for ordinary conversation. This is off by
default. To use it, an operator turns on unaddressed intake and lists the
conversations it applies to in
`OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS`, as
comma-separated `<provider>:<conversation id>` entries such as `feishu:oc_…`
or `slack:C…`. Only listed conversations are followed; `*` lists every
conversation, and an empty list follows none. A Slack app must also subscribe
to the `message.channels` and `message.groups` events.
