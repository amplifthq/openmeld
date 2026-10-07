---
id: hosted-agent-retained-context
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1541","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","pr:1554","commit:0b048940e491d46ab4a03d7317b4259b1176ef26","worker-version:59b1b4ec-4357-41aa-a156-ec9bd1aab1bc","pr:1556","commit:9e377afcb9686978faeb332493a8c03d76646f5a"]
title: Reduce repeated tool output in hosted agent context
kind: improved
areas: ["center-agent", "remote-agents"]
audiences: ["members"]
---

Hosted agents can omit older completed tool-output previews when their working
context is full. They keep completion details and references for reading the
original output when needed. Recent results stay visible, and normal history
compaction still runs when the context needs more space.
