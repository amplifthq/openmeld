---
id: keep-quota-reads-off-wake-admission
title: Keep slow usage checks from blocking ready Agents
kind: fixed
areas: ["agents"]
audiences: ["users"]
---

Agents can start work when a usage check is temporarily unavailable. Confirmed
usage limits still prevent new work, and tasks held after reaching a limit still
wait for confirmed recovery. Account, permission, and computer checks remain in
place.
