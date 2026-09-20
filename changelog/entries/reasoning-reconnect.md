---
id: reasoning-reconnect
publishedAt: 2026-09-14
release: v0.3.205
evidence: ["pr:1047", "pr:1052", "commit:d913ca02e16ca64e934f967a8dd017d09982192e", "workflow:34879030368", "workflow:34879035286"]
title: Restore recent live reasoning after reconnecting
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

Spaces can restore an Agent's recent live reasoning when you refresh or reconnect,
without waiting for another reasoning update. The temporary tail is available
while the server retains it in memory; it is not saved in conversation history.

Live reasoning supports basic Markdown formatting and stays open while an Agent
switches between thinking and using tools. If you collapse it, new output keeps
it collapsed until you choose to open it again.

Reopening follows the latest reasoning. Turning off Local Agent reasoning sharing
also blocks reconnect replay without waiting for the owner's computer to respond.
