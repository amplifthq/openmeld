---
id: model-catalog-actionable-reviews
publishedAt: 2026-10-03
release: v0.3.238
evidence: ["pr:1468","commit:f75bb375a68dcb3a35b475b6fa89e07141b1396d"]
title: Model catalog reviews highlight actionable changes
kind: improved
areas: ["developer-workflow", "model-catalog"]
audiences: ["contributors"]
---

Automated model reviews lead with newly discovered candidates, changed model
options, and retirement notices that need attention. Discovery recommendations
require text output and tool calling, keeping media-only models out of coding
agent reviews. Announced retirement dates trigger one verification reminder
without automatically disabling models. Unchanged evidence remains available
without opening another pull request.
