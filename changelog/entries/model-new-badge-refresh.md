---
id: model-new-badge-refresh
title: Clearer model labels and another Center Agent option
kind: improved
areas: ["agents", "models", "center-agent"]
audiences: ["users"]
publishedAt: 2026-10-01
release: v0.3.233
evidence: ["pr:1411", "commit:e4454cf165b96c7f918e420f28205c2b2ed3c575", "workflow:36831389174"]
---

Model selectors show New for the latest reviewed releases, including GPT-6.1
Sol and Claude Sonnet 5.5. Older models such as GLM 5.3 Flash no longer carry
the label. The CLI's offline catalog also drops its old GLM label.

Center Agents and personal Remote Agents gain GPT-6 Astra (Pro mode) as an
additional option. GPT-6.1 Sol (Pro mode) and GPT-6 Astra (Pro mode) are labeled
as modes of their underlying models. Existing selections and defaults stay the
same.
