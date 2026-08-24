---
id: agent-answers-stay-content
title: Keep Agent answers separate from execution state
kind: fixed
areas: ["agents", "spaces", "center-agent", "cli"]
audiences: ["members", "admins"]
---

OpenMeld now decides Agent authentication, tool activity, Space publication,
recovery, and completion from typed runtime evidence and dispatch-scoped tool
records. Words, JSON, or protocol-like examples inside an Agent's answer remain
ordinary content and no longer change what OpenMeld does.

OpenMeld Tools will require the matching Service and managed Skill update so an
older local runtime cannot keep using the unsafe text-based behavior.
