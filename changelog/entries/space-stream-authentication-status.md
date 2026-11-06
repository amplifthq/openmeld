---
id: space-stream-authentication-status
title: Distinguish Space sign-in failures from server errors
kind: fixed
areas: ["spaces", "web"]
audiences: ["members", "operators"]
---

Space live connections now preserve authentication and access failures instead
of reporting them as server errors. Session-deletion cookies are retained, and
diagnostics distinguish rejected connections from service failures so expired
sessions do not generate misleading API server-error alerts.
