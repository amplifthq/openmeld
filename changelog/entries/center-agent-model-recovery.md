---
id: center-agent-model-recovery
title: Center Agent reconnects after temporary model failures
kind: improved
areas: ["center-agent", "spaces"]
audiences: ["users"]
---

Center Agent retries temporary model failures up to five times with increasing
delays. The conversation shows Reconnecting and the retry count while keeping
your progress and Stop control available. Work continues in the same task when
the connection recovers. If all retries fail, the task reports a failure.
