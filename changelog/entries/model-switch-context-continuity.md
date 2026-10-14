---
id: model-switch-context-continuity
title: Continue long conversations after changing models
kind: fixed
areas: ["center-agent", "remote-agent"]
audiences: ["users"]
---

Long conversations can prepare their history in smaller steps when the next
request uses a model with less context capacity. Existing command results and
files remain available without repeating completed work. A model change does
not interrupt a command already running. Capacity failures now explain the
limit without promising that a retry will resolve it.
