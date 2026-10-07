---
id: native-cloud-computer
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1537","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","pr:1554","commit:0b048940e491d46ab4a03d7317b4259b1176ef26","worker-version:59b1b4ec-4357-41aa-a156-ec9bd1aab1bc"]
title: Use native tools on your cloud Computer
kind: improved
areas: [agents, computers, cli]
audiences: [users]
---

Center, Remote and Local Agents can use the same file tools, Linux programs,
fast shell and isolated JavaScript on your personal cloud Computer. Each engine
can access the network and work with your persistent files. Commands support
environment variables, input and results. Linux and Worker JavaScript support
retained execution and cancellation. The lightweight shell runs to completion.

Local Agents can inspect available capabilities with `openmeld computer cloud
--operation '{"action":"describe"}' --view agent`. Browser and private preview
operations use the same interface when available. Account connections still use
Plugins; no additional authorization screen or virtual desktop is introduced.
