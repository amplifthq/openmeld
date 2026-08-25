---
id: sustainable-center-agent-conversations
title: Keep long Center Agent conversations working
kind: fixed
areas: ["center-agent", "conversations"]
audiences: ["members"]
---

Center Agent now adapts long-conversation recovery to the selected controller
model. When older stored history is already too large for that model, OpenMeld
carries a bounded continuity context into a fresh internal generation and
continues the same message. The complete provider request is checked again
before sending, so members can keep using the same Space or direct message
instead of starting over.
