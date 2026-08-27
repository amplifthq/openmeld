---
id: consistent-center-agent-failure-outcomes
title: Stop waiting when Center Agent work has failed
kind: fixed
areas: ["center-agent", "spaces", "cli"]
audiences: ["members"]
---

When Center Agent work ends in failure, OpenMeld now reports that same final
outcome in the conversation, progress checks, diagnostics, and the CLI Wake
trace summary. Agents no longer keep waiting, treat a failed turn as an
ordinary reply, or suggest that a failed response is still being published.
