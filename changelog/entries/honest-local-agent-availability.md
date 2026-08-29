---
id: honest-local-agent-availability
title: Show when a local agent is truly unavailable
kind: fixed
areas: ["agents", "computers", "local-agents"]
audiences: ["members"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:448", "commit:0e93f6d26f549ca49565e7f1101e8cef5bef1b35", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:acb7e69e-ffed-4ef2-96e7-c734a2598961", "worker-version:c3c4d138-2fd2-4df6-9ef2-d49fb24cf085", "pr-comment:5463688488"]
---

Local agents that are signed out or blocked by provider access now appear as
Unavailable instead of a red launch error. Computers and Agent Profiles use the
newest exact local runtime evidence, distinguish temporary rate limits from
hard account or quota blockers, and point to the provider action needed before
the agent can run again.
