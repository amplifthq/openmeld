---
id: bounded-message-reads-and-github-issue-confirmation
title: Read longer conversations and resume safely
kind: improved
areas: ["spaces", "center-agent", "plugins"]
audiences: ["members", "agents"]
---

Conversation search and Agent history reads share the same message source.
Agents can request more than 100 messages and continue in bounded batches.
Long messages have explicit segments, and saved read positions help an Agent
resume after context compaction.
Selecting a search result again returns to that message without a page reload.

GitHub issue tools send the required write classification and show pending
destination confirmation explicitly. Existing authorization and Task review
rules still apply. Retrying the same approved operation does not create a
second issue.
