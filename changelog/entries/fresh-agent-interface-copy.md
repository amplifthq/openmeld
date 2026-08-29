---
id: fresh-agent-interface-copy
title: Always copy a fresh Agent Interface prompt
kind: fixed
areas: ["setup", "web", "agent-interface"]
audiences: ["members"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:471", "commit:1c148e24d05fc05ce0fbf9f53f4f9595b05ff446", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:c3c4d138-2fd2-4df6-9ef2-d49fb24cf085"]
---

Agent Interface now replaces expired one-time setup credentials before Copy
writes the prompt to the clipboard. The button waits for a complete fresh
prompt and can be retried in place, so users no longer copy a command that
OpenMeld already knows will fail.
