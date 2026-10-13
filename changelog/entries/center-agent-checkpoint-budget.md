---
id: center-agent-checkpoint-budget
title: Fewer interruptions in long Center Agent conversations
kind: fixed
areas: ["center-agent"]
audiences: ["users"]
---

The Center Agent now requests shorter working summaries so they can finish
before the model's output limit. Original messages and completed operation
results remain available if a summary fails, including after a restart.
