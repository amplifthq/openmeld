---
id: retire-remote-agent-core-rollout-fallbacks
title: Retire completed Remote Agent rollout fallbacks
kind: improved
areas: ["center-agent", "operations"]
audiences: ["operators", "contributors"]
---

Remote Agent now requires the current Core contracts for Slack results,
Message Channel account linking, and connected App progress. It no longer
downgrades requests or progress metadata for older Core versions. Keep Core
current before deploying this worker; roll back Remote Agent first when
reverting those Core contracts. Existing local clients and saved conversation
formats are unchanged.
