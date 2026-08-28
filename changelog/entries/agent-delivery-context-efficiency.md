---
id: agent-delivery-context-efficiency
title: Keep delivery status concise and scope-specific
kind: improved
areas: ["developer-experience", "ci-cd"]
audiences: ["contributors", "operators"]
---

OpenMeld delivery tooling can now wait for Final Candidate without streaming
full workflow logs into an agent's context, identify GitHub Actions budget
refusals before blaming candidate code, summarize local development resource
use by worktree, and separate one merged change's release scopes from unrelated
production backlog. Local-component releases also show changed components,
public versions, compatibility floors, and require an explicit `available` or
`required` decision with a concrete reason instead of silently choosing one.
