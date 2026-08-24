---
id: keep-local-agent-installs-available
title: Keep all working Local Agent installs available
kind: fixed
areas: ["openmeld-service", "local-agents"]
audiences: ["members"]
---

OpenMeld now keeps the Local Agent install it is already using in the
computer's list while also looking for other working installs. When the same
Local Agent is installed more than once, every detected choice stays available
instead of hiding the option to switch. OpenMeld also recognizes the Codex
included with the ChatGPT app, shows the source and version of each working
Codex installation, and uses a signed-in ChatGPT Codex automatically on first
use.
