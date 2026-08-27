---
id: read-members-and-tasks-with-center-agent
title: Read Organization members and Tasks with the Center Agent
kind: improved
areas: ["center-agent", "organizations", "tasks"]
audiences: ["members"]
publishedAt: 2026-08-27
release: v0.3.121
evidence: ["pr:370", "commit:9571067601e5585c832107cc3eafacc39f0b27db", "commit:45c4edfdabfa862bc52f30c801d04bb81ba813e1", "workflow:33081538161", "worker-version:74602f63-8435-4dc8-8b81-18ed6b0dccb3", "center-agent-dispatch:b4082b85-ceb5-4163-ad4d-d1959c3b9fdf", "center-agent-dispatch:27544c1c-f5eb-42af-8155-8198bde4c025", "center-agent-dispatch:9e35b24a-78e8-49f3-afbf-4794287c730e", "center-agent-dispatch:10b284af-4e31-41d0-92ad-73649f0973d3"]
---

The Center Agent can page through Organization members without loading
unrelated Agent Profile readiness, and can read the requester's canonical
OpenMeld Tasks separately from local coding-agent task handles.
