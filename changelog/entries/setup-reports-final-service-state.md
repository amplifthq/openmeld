---
id: setup-reports-final-service-state
title: Setup now reports the final Service state safely
kind: fixed
areas: ["computers", "openmeld-service", "setup"]
audiences: ["members"]
publishedAt: 2026-08-28
release: v0.3.124
evidence: ["pr:437", "commit:35d70dc55e773807b6418081eaae0c50e91d5e54", "pr:438", "commit:bd155280f9a5279e2cb5ba4192cf0e0c67e015f6", "tag:v0.3.124", "npm:openmeld@0.3.124", "cloudflare:core:111a0af1-1136-4486-a59b-67cb9c12ce01", "smoke:dispatch:4cfa8efe-eff5-436d-b404-eb6b976e178f"]
---

Computer setup now finishes successfully after OpenMeld Service recovers from
a temporary start delay, and shows the Service as connected even when no local
agents are installed yet. Development, Staging, and Canary setup also stay
isolated from the published OpenMeld Service on the same computer.
