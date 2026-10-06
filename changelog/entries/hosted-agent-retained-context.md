---
id: hosted-agent-retained-context
title: Reduce repeated tool output in hosted agent context
kind: improved
areas: ["center-agent", "remote-agents"]
audiences: ["members"]
---

Hosted agents can omit older completed tool-output previews when their working
context is full. They keep completion details and references for reading the
original output when needed. Recent results stay visible, and normal history
compaction still runs when the context needs more space.
