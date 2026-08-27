---
id: consistent-center-agent-failure-outcomes
title: Stop waiting when Center Agent work has failed
kind: fixed
areas: ["center-agent", "spaces", "cli"]
audiences: ["members"]
publishedAt: 2026-08-27
release: v0.3.121
evidence: ["pr:357", "pr:382", "commit:7f438b73a1076d7436fe330862e09681ec4b0e45", "commit:45c4edfdabfa862bc52f30c801d04bb81ba813e1", "workflow:33079113134", "npm:openmeld@0.3.121"]
---

When Center Agent work ends in failure, OpenMeld now reports that same final
outcome in the conversation, progress checks, diagnostics, and the CLI Wake
trace summary. Agents no longer keep waiting, treat a failed turn as an
ordinary reply, or suggest that a failed response is still being published.
