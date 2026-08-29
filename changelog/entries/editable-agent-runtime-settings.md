---
id: editable-agent-runtime-settings
title: Edit Agent settings without leaving active work
kind: improved
areas: ["agents", "spaces", "local-service"]
audiences: ["members"]
publishedAt: 2026-08-29
release: v0.3.125
evidence: ["pr:429", "commit:8bcba73941cb81c42645c7ec0043b88e446eb33c", "pr:444", "commit:56a850c455885b6333e2a0481210bffb6cd05a85", "tag:v0.3.125", "npm:openmeld@0.3.125", "cloudflare:core:36a3a37c-ec7e-4016-86f9-d1a1135ab4d9", "cloudflare:web:4390bb7f-3da9-4ba1-a24c-caecbcc1bfe2", "smoke:dispatch:d2b5a483-93d6-4e8a-98e9-671c93577679", "smoke:dispatch:a0397aa6-fd6a-46ae-be20-93cda8cd9aba"]
---

Agent owners can save model, reasoning, and permission settings while a Wake is
running, including from an in-Space permission request. A Permission Mode
change can now reach later tool requests in that running session when the local
agent supports a native live update. Requests that were already waiting still
need their own response, and unsupported agents keep the mode they started
with. OpenCode permissions remain saved for new work, while disruptive
Controller changes, unbinding, and working-folder changes stay unavailable
until active work finishes.
