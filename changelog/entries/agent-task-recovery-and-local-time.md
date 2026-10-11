---
id: agent-task-recovery-and-local-time
title: More reliable task follow-up and local time
kind: fixed
areas: ["center-agent", "agents", "computer"]
audiences: ["users", "developers"]
publishedAt: 2026-10-09
release: v0.3.250
evidence: ["pr:1616","commit:96cb28b5a32f3757c6fd2b78ede81044a45a5a6b","workflow:37842505316","desktop-candidate:01d11dfbce315c66a6fb27a87bad03d87ce6dd2a5305c90403ef96bfe20b5797","deployment:openmeld-auth-prod/e46d7fea-320e-4e87-855a-b280d8758984","deployment:openmeld-remote-agent-prod/c2699293-462c-45a7-b842-29120d947388","deployment:openmeld-gateway-prod/186ac65f-de37-48d5-9586-b440e38a045a","deployment:openmeld-web-prod/105bd493-2203-4b23-bafe-100ed7fd4e76","deployment:openmeld-core-prod/3086fdb3-fbad-42f9-8a7e-a3fb5b8a026c","commit:07158c4b07e9c63fbccdb5f3f9d1c09711f1a5d9"]
---

Cloud Computer commands keep their recorded exit results when file synchronization
loses its connection. Slow command checks have a time limit, and one stuck check
no longer holds up the other commands. Agents can inspect the retained result
before deciding what to do next.

When a Space coordinator cannot finish because a retained Computer command was
lost, the Center Agent can make one restricted attempt to summarize the completed
Agents' published results. This does not restart their work or override Stop.

Web, macOS Desktop, and Local Service share the same user time-zone record. Remote
Agents receive that time zone, the original request time, and a fresh current
time for each model request. Queued messages retain their original time context.
Local Agents are guided to use the user's local environment
unless the task calls for Cloud Computer.
