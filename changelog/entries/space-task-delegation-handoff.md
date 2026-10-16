---
id: space-task-delegation-handoff
title: Keep delegated work connected to its Task
kind: fixed
areas: ["spaces", "center-agent"]
audiences: ["users"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["commit:682d4fd273675b9dc405456a2c46a68aa24d8f4d", "commit:98fb79da6893ac5971c616f6d43161bfbebc6795", "commit:9f1f6f8b4ec2f628288a77593042f33d51bf1d47", "workflow:38863835438"]
---

Delegating an existing Space Task records its assignee and reviewer together
with the work request. Agents receive the same Task through implementation,
result submission, review, and requested changes. Task progress remains separate
from execution status, and a missing reviewer is reported instead of silently
dropping the requested review.
Handoffs reach only their intended Agent, including in Spaces using listen-all,
and unrelated Project or issue updates do not discard a pending work request.
