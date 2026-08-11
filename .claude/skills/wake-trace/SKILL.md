---
name: wake-trace
description: Use when diagnosing a Wake that failed, stalled, or produced no visible reply — dispatch, setup handoff, or reply-path issues. Routes to the deterministic trace evidence path.
---

# Wake Trace (thin router)

Read `developing/architecture/agent-transport-contract.md` and
`developing/architecture/data-and-observability.md` before drawing a
conclusion. They own execution truth, trace interpretation, and diagnostic
boundaries; do not restate those rules here.

## Entry point

```
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

Choose any deeper trace or lane-specific step from those owner documents and
`developing/engineering/development-workflow.md`.
