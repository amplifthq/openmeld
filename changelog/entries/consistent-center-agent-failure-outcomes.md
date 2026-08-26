---
id: consistent-center-agent-failure-outcomes
title: Stop waiting when Center Agent work has failed
kind: fixed
areas: ["center-agent", "spaces", "cli"]
audiences: ["members"]
---

When Center Agent work ends in failure, OpenMeld now reports that same final
outcome in the conversation, CLI, progress checks, and diagnostics. Agents no
longer keep waiting or suggest that a failed response is still being published.
