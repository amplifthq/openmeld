---
id: computer-delayed-wake-admission
title: Check delayed Wakes before starting an Agent
kind: fixed
areas: ["computers", "agents"]
audiences: ["users"]
---

Before starting an Agent, the Computer checks that OpenMeld still authorizes the
Wake. A Wake that expired while the execution process was paused is rejected
before the Agent can run. The first Computer connection also preserves the
running Service's identity so its normal Stop control remains available.
