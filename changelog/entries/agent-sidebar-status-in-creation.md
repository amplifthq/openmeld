---
id: agent-sidebar-status-in-creation
title: Give Agent creation its own page and reduce status reads
kind: fixed
areas: ["agents", "web"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.158
evidence: ["pr:654", "pr:658", "commit:8b98ac0d0882e70a00f5f3eb6b7f818073a27254"]
---

Create Agent now opens its own page without the Agent-list sidebar. Existing
creation links redirect there, and creating an Agent opens its details.

Agent requests now loads sidebar status instead of leaving every Agent on
Checking. Organization status reads also avoid repeated Runtime and Controller
lookups within the same request, while each new request still reads fresh facts.
