---
id: feishu-lark-live-answer-streaming
title: Watch replies appear in Feishu and Lark
kind: improved
areas: ["channels", "center-agent"]
audiences: ["members"]
---

The Center Agent now sends answer text to its Feishu and Lark cards as it is
generated, instead of waiting for the finished response. The first words appear
immediately after they are generated, and later text updates in short batches.
Introductions are shown before a tool runs, and the same card holds the final
reply. Private model reasoning is never shown.

Stop a running answer from its card, or expand Follow up to send the next
request in the same conversation. You can also ask the Center Agent to schedule
a Routine in the current Feishu or Lark chat. Each scheduled run keeps its
original destination even if the Routine changes later.

Feishu and Lark business tools have separate App connections for documents,
wikis, tables, calendars, and tasks. Connecting a messaging bot does not grant
access to these resources. Lark business tools require the companion
OpenConnector provider and OAuth client configuration.
