---
id: safer-center-agent-core-releases
title: Safer Center Agent releases
kind: improved
areas: ["center-agent", "reliability"]
audiences: ["admins", "members"]
---

OpenMeld now checks Core's real Cloudflare startup time on a zero-traffic
version before a release can replace the working production version. Cloudflare
rejections stop safely, while accepted versions above OpenMeld's performance
target continue with explicit warning evidence instead of blocking delivery.
