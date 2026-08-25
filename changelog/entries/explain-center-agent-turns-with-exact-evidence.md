---
id: explain-center-agent-turns-with-exact-evidence
title: Explain Center Agent turns with exact runtime evidence
kind: improved
areas: ["center-agent", "diagnostics", "performance"]
audiences: ["members", "admins"]
---

Center Agent diagnostics now separate delivery, publication, model timing, tool
discovery, tool calls, and tool-budget exhaustion for the exact reported turn.
Older turns without retained evidence and temporarily unavailable diagnostics
are shown as different states instead of being guessed from the wording of the
reply. Operators can also compare weighted Center Agent latency percentiles by
channel and model without storing prompt or reply content.
