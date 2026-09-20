---
id: desktop-workspace-retry
title: Retry opening a Desktop workspace without signing in again
kind: fixed
areas: ["desktop"]
audiences: ["users"]
evidence: ["pr:1145"]
---

Desktop offers Retry when a temporary connection or workspace-loading failure
prevents entry. Retrying checks the existing session and returns to the intended
page without starting browser sign-in or clearing same-account drafts. Browser
sign-in remains available when the session check confirms you are signed out.
