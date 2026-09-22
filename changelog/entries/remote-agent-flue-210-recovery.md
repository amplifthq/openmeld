---
id: remote-agent-flue-210-recovery
title: Remote Agent recovery preserves completed work and correct replies
kind: fixed
areas: ["center-agent", "remote-agent"]
audiences: ["members", "admins"]
---

Remote Agent uses the Flue 2.1.0 runtime while preserving existing conversations
and exact-task controls. Interrupted execution retains recorded tool results;
recovery can recognize completed work even when execution resources are
unavailable, and repeated preparation failures no longer wait indefinitely.

When a model retries a failed streamed answer, the replacement removes the
failed text without removing earlier tool updates. Completed answers, model
information, and recorded usage survive interruptions before final delivery.
Delivery retries do not count the same recorded usage again. Stop and safety
failures continue to prevent a late answer from replacing the actual outcome.
