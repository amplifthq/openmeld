---
id: center-agent-failure-diagnostics
title: Stop replacing completed Center Agent answers
kind: fixed
areas: ["center-agent", "diagnostics", "channels"]
audiences: ["members", "admins"]
---

Completed Center Agent answers are no longer replaced with a generic failure
just because ordinary prose includes words such as `Failure` or `Session`.
Genuine execution and publication failures now keep a protected diagnostic
reason instead of being saved as successful replies.
