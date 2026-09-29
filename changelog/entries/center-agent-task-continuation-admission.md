---
id: center-agent-task-continuation-admission
title: Keep Center Agent task continuations moving
kind: fixed
areas: ["center-agent", "wakes"]
audiences: ["members"]
---

Center Agent can resume after a delegated Wake ends even when its conversation
needs a fresh runtime generation. If the delegated Wake expired before reaching
the local Agent, Center Agent receives that outcome explicitly instead of
waiting for a generic admission timeout.
