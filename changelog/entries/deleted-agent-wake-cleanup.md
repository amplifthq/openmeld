---
id: deleted-agent-wake-cleanup
title: Clear pending Wakes for deleted agents
kind: fixed
areas: ["spaces", "agents"]
audiences: ["users"]
---

Old pending Wakes stop retrying when their agent has been deleted. Spaces shows
a simple system message explaining that the Wake was cancelled, instead of
leaving it on "Trying to reach".
