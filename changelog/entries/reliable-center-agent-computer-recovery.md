---
id: reliable-center-agent-computer-recovery
title: Keep Center Agent requests moving through Computer reconnects
kind: fixed
areas: ["center-agent", "computers", "tasks"]
audiences: ["members", "admins"]
---

Center Agent requests now recover when the private Computer reconnects while a
turn is being prepared. OpenMeld resumes the same request from durable state
before any model or tool work starts, without repeating completed external
actions. If recovery cannot finish, the request reaches one clear failure
instead of remaining indefinitely active.
