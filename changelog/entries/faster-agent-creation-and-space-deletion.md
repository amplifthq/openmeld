---
id: faster-agent-creation-and-space-deletion
publishedAt: 2026-09-14
release: v0.3.205
evidence: ["pr:1050", "pr:1052", "commit:d913ca02e16ca64e934f967a8dd017d09982192e", "workflow:34879030368", "workflow:34879035286"]
title: Move on immediately after creating an Agent or deleting a Space
kind: improved
areas: ["agents", "spaces"]
audiences: ["members"]
---

Agent creation now returns you to Agents as soon as you submit, with setup
progress while the request is confirmed. You can edit and retry an unfinished
request or dismiss its local card. Deleting a Space immediately opens Browse
Spaces and removes it from the lists. If deletion fails, the Space returns and
a persistent error includes a link to reopen it.
