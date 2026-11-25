---
id: account-sessions-query-errors
title: Clear recovery when account sessions cannot load
kind: fixed
areas: ["account", "authentication"]
audiences: ["members"]
---

Account settings distinguish a failed session-list request from an empty list.
Older sign-ins prompt you to sign in again, and temporary failures offer a retry.
Session counts and management actions appear only after the list loads successfully.
