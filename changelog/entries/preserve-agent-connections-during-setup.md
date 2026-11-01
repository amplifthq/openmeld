---
id: preserve-agent-connections-during-setup
title: Keep your local agent connections when reconnecting
kind: fixed
areas: ["cli", "onboarding"]
audiences: ["users"]
---

Running OpenMeld Setup connects newly discovered local agents while preserving
existing On/Off choices. An agent excluded from automatic selection no longer
gets turned off, and agents you turned off stay off. If an enabled agent is
missing its launch configuration, Setup restores it when it can verify the
installation on this computer.
