---
id: local-agent-completion-context
title: Reduce repeated context in local Agent conversations
kind: improved
areas: ["agents"]
audiences: ["users"]
---

Local Agents with verified native instruction delivery receive fewer repeated
completion rules on each Wake. The current request, permitted actions, and
task facts remain in every turn. Existing conversations without matching
instruction evidence keep the complete prompt.

Local Agents can also search large Space tool results for exact text and read
the surrounding original content. Complete results remain available through
paging, and every read checks source access and version again.
