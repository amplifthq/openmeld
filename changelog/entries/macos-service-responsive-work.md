---
id: macos-service-responsive-work
title: Give Space requests responsive scheduling on Mac
kind: improved
areas: ["agents", "service"]
audiences: ["users"]
---

OpenMeld identifies its Mac service as work that people are waiting on, so macOS
does not apply the default background-job resource limits to Agent execution.
Normal Service updates apply the setting. Startup deadlines, bounded retries,
and Stop behavior remain unchanged.
