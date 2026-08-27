---
id: recover-center-agent-answers-after-lost-callbacks
title: Keep finished Center Agent answers when the final delivery fails
kind: fixed
areas: ["center-agent", "wake"]
audiences: ["members"]
---

When a Center Agent runtime finishes its work but the final delivery back to
OpenMeld fails, the Space now publishes the answer the agent already produced
instead of reporting a generic failure. Cancelled wakes stay stopped, and an
answer is never published more than once.
