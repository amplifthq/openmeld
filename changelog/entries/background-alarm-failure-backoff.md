---
id: background-alarm-failure-backoff
title: Slow repeated background retries during service failures
kind: fixed
areas: ["reliability", "files", "agents"]
audiences: ["operators"]
publishedAt: 2026-10-09
release: v0.3.250
evidence: ["pr:1608","commit:2de34997f690f3c6bc87c396a2a40e040a96051c","deployment:openmeld-core-prod/5f8bc475-54c4-45fd-ae16-c3396ba97ab7"]
---

Failed background cleanup and execution-recovery steps now wait progressively
longer before retrying, reducing unnecessary cloud activity during persistent
failures. Healthy work can continue, pending work is retained, and normal retry
timing resumes after recovery.
