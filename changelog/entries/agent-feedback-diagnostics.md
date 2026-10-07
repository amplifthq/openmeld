---
id: agent-feedback-diagnostics
publishedAt: 2026-10-07
release: v0.3.247
title: Clearer Agent status and Space diagnostics
kind: fixed
areas: ["cli", "agents", "spaces"]
audiences: ["users", "agents"]
evidence: ["pr:1558", "pr:1568", "workflow:37607115073"]
---

Space progress, Stop, and result commands accept copied Space links. Missing
result archives now explain that a Hosted reply can still exist and point to
the exact execution trace.

Usage Limit messages identify the reason an Agent cannot start new work.
Local CLI readiness describes local setup without promising that a Wake can
start. Pending trace projections no longer suggest an offline Computer without
evidence. Detailed traces explain the difference between completed Agent
operations and individual model-provider requests.
