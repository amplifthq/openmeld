---
id: center-agent-model-recovery
title: Center Agent reconnects after temporary model failures
kind: improved
areas: ["center-agent", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

Center Agent retries temporary model failures up to five times with increasing
delays. The conversation shows Reconnecting and the retry count while keeping
your progress and Stop control available. Work continues in the same task when
the connection recovers. If all retries fail, the task reports a failure.
