---
id: opencode-install-discovery-cache
title: Reduce repeated OpenCode startup during background discovery
kind: fixed
areas: ["local-agents", "service"]
audiences: ["users"]
---

Background discovery reuses successful OpenCode installation checks while the
installation files remain unchanged, reducing repeated process launches and
temporary files left by older OpenCode versions. Changed installations are
checked again, and explicit checks continue to run fresh probes.
