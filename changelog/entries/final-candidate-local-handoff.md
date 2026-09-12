---
id: final-candidate-local-handoff
title: Finish hosted validation before local certification takes over
kind: fixed
areas: ["engineering", "ci"]
audiences: ["contributors"]
---

Local Final Candidate certification now stops and waits for the same PR's
active hosted validation before publishing its own result. A late hosted
publisher can no longer overwrite that result and force repeated local checks.
If the handoff cannot be confirmed, local publication stops with an error.
