---
id: auth-and-desktop-security-updates
title: Security updates for sign-in and the Desktop runtime
kind: security
areas: ["auth", "desktop", "development"]
audiences: ["members", "admins", "developers"]
---

Better Auth 1.7.7 fixes a vulnerability that could allow an OAuth sign-in state
to be reused as a magic link. OpenMeld Desktop also updates to Electron 44.9.1,
and the local Workers development tools use Undici 7.30.1 for HTTP requests.
After the Auth update, request a fresh link or restart any sign-in in progress.
