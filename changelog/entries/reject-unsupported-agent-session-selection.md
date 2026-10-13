---
id: reject-unsupported-agent-session-selection
title: Explain unsupported Agent session choices before sending
kind: fixed
areas: ["agents", "spaces", "cli"]
audiences: ["users", "developers"]
---

Requests to start, fork or continue a selected session now fail clearly when the
chosen Agent does not support session selection. OpenMeld no longer silently
uses the existing hosted conversation. The CLI checks before uploading files;
the server checks before creating the message, Task or Wake. Existing file
handoffs remain available.
