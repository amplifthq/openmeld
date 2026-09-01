---
id: load-people-and-agents-without-runtime-waterfalls
title: Open People and Agents without runtime waterfalls
kind: fixed
areas: ["directory", "agent-profiles"]
audiences: ["members"]
---

People now loads member and profile identity without waiting for Agent runtime
checks. Agents shows those identities first, then fills in current readiness and
activity through one batched follow-up instead of blocking the whole page on a
chain of per-Agent requests.
