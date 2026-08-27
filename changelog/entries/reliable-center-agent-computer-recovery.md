---
id: reliable-center-agent-computer-recovery
title: Keep Center Agent requests moving through Computer reconnects
kind: fixed
areas: ["center-agent", "computers", "tasks"]
audiences: ["members", "admins"]
publishedAt: 2026-08-27
release: v0.3.121
evidence: ["pr:302", "commit:1c269512ebd2a27dc870e5cd695e786d3868ae18", "commit:45c4edfdabfa862bc52f30c801d04bb81ba813e1", "workflow:33081538161", "worker-version:74602f63-8435-4dc8-8b81-18ed6b0dccb3"]
---

Center Agent requests now recover when the private Computer reconnects while a
turn is being prepared. OpenMeld resumes the same request from durable state
before any model or tool work starts, without repeating completed external
actions. If recovery cannot finish, the request reaches one clear failure
instead of remaining indefinitely active.
