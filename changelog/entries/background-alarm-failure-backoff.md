---
id: background-alarm-failure-backoff
title: Slow repeated background retries during service failures
kind: fixed
areas: ["reliability", "files", "agents"]
audiences: ["operators"]
---

Failed background cleanup and execution-recovery steps now wait progressively
longer before retrying, reducing unnecessary cloud activity during persistent
failures. Healthy work can continue, pending work is retained, and normal retry
timing resumes after recovery.
