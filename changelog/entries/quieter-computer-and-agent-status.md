---
id: quieter-computer-and-agent-status
title: Keep offline and sign-in states quiet on Computers
kind: improved
areas: ["computers", "local-agents", "web"]
audiences: ["members"]
evidence: ["pr:337"]
---

Computer offline, local agent signed out, and local agent setup states no
longer read as failures. An offline computer now shows a gray dot instead of
red, a signed-out local agent renders like a switched-off one (gray logo,
title, and description with a "Not signed in" note), and the Computers summary
asks for setup or sign-in instead of claiming a repair. Red attention stays
reserved for real failures such as a broken local agent launch or a required
service update.
