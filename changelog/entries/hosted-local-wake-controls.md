---
id: hosted-local-wake-controls
title: Keep cloud Agents independent of local connections
kind: fixed
areas: [agents, spaces]
audiences: [users]
---

Remote and Center Agents no longer receive local connection repair actions when
their status cannot be confirmed. Local Agents keep their connection controls.
Mention only preserves the draft and prevents automatic Agent work, including in
Direct Messages. Stop stays attached to a Hosted Agent request as it continues
across work batches and handoff cleanup, with a saved stopped notice once
stopping is confirmed. A saved Stop request is acknowledged even while delivery
or cleanup needs retrying. Interrupted stopped-notice publication and delayed
execution records are recovered without running the task again. Requests already
stopped before admission do not consume an admission.
