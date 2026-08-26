---
id: prevent-incompatible-local-agent-models
title: Prevent incompatible Local Agent model choices
kind: fixed
areas: ["agent-profiles", "local-agents", "spaces"]
audiences: ["members"]
publishedAt: 2026-08-26
release: v0.3.111
evidence: ["pr:292", "pr:301", "commit:5bc5c6e8", "npm:openmeld@0.3.111"]
---

When a selected Local Agent installation clearly cannot run a model, OpenMeld
now disables that model while an Agent Profile is created or edited. The dialog
explains why and links directly to the Computer where the member can update or
change the installation. Missing compatibility information does not block the
member or make OpenMeld guess. Existing Agents that hit the same problem during
a Wake now get the same direct Computer recovery path.
