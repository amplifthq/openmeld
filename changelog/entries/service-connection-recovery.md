---
id: service-connection-recovery
title: More reliable computer connections and recovery
kind: fixed
areas: ["service", "computers", "wakes"]
audiences: ["users"]
publishedAt: 2026-09-15
release: v0.3.206
evidence: ["pr:1051", "pr:1055", "workflow:34902801271", "commit:ca92fef004ea00bc726f34015ba1ae2e9ba0cbda"]
---

Temporary credential-store delays no longer disconnect a working computer, and
switching Organizations keeps the same local connection. When a connection is
interrupted, OpenMeld resumes retries as soon as credentials are available and
gives running work more time to reconnect without starting it again.

Your computer's Connection history shows recent interruptions and automatic
recovery. Private, limited diagnostic summaries upload after reconnection to
help explain what happened without sharing chat content or credentials.
