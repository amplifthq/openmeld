---
id: space-cli-addressing-and-continuation
title: Clearer Space addressing and task continuation
kind: fixed
areas: ["cli", "spaces", "agents"]
audiences: ["users", "developers"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["commit:682d4fd273675b9dc405456a2c46a68aa24d8f4d", "workflow:38863835438"]
---

The CLI catches repeated leading recipient names before sending. Continue or
fork a task from its original request or an Agent reply with recorded task
details. Reply threads remain a separate choice.

When a selected task is unavailable, OpenMeld explains how to select another
source or start a new task instead of reporting a model-provider outage.
