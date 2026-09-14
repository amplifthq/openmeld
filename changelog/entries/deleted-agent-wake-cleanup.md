---
id: deleted-agent-wake-cleanup
publishedAt: 2026-09-14
release: v0.3.205
evidence: ["pr:1048", "pr:1052", "commit:d913ca02e16ca64e934f967a8dd017d09982192e", "workflow:34879030368", "workflow:34879035286"]
title: Clear pending Wakes for deleted agents
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

Old pending Wakes stop retrying when their agent has been deleted. Spaces shows
a simple system message explaining that the Wake was cancelled, instead of
leaving it on "Trying to reach".
