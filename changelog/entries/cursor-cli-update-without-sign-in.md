---
id: cursor-cli-update-without-sign-in
title: Update an older Cursor CLI without signing in
kind: fixed
areas: ["computers", "local-agents"]
audiences: ["members"]
---

Computer details for an older Cursor CLI that is not signed in now copy
Cursor's official installer. `cursor-agent update` on those builds stops with
an unauthenticated error before it can install the newer version. Signed-in
Cursor CLIs, current Cursor CLIs, and Homebrew installs still use their own
update command.
