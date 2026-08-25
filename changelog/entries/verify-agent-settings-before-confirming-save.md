---
id: verify-agent-settings-before-confirming-save
title: Confirm Agent settings only after they are saved
kind: fixed
areas: ["agents", "web"]
audiences: ["members", "admins"]
---

OpenMeld now verifies permission, collaboration, model, reasoning, and OpenCode
permission changes before showing “Settings saved.” If the local Service
reconnects during a save, OpenMeld reports the conflict instead of leaving the
old setting in place behind a success message.
