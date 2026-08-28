---
id: editable-agent-runtime-settings
title: Edit Agent settings without leaving active work
kind: improved
areas: ["agents", "spaces", "local-service"]
audiences: ["members"]
---

Agent owners can save model, reasoning, and permission settings while a Wake is
running, including from an in-Space permission request. A Permission Mode
change can now reach later tool requests in that running session when the local
agent supports a native live update. Requests that were already waiting still
need their own response, and unsupported agents keep the mode they started
with. OpenCode permissions remain saved for new work, while disruptive
Controller changes, unbinding, and working-folder changes stay unavailable
until active work finishes.
