---
id: connect-computers-before-agent-setup
title: Connect computers without waiting for Agent setup
kind: improved
areas: ["setup", "openmeld-service", "computers"]
audiences: ["members"]
publishedAt: 2026-08-28
release: v0.3.124
evidence: ["pr:395", "commit:b820b5d4bd336b640b7691f36b1b60f2c7930b75", "pr:438", "commit:bd155280f9a5279e2cb5ba4192cf0e0c67e015f6", "tag:v0.3.124", "npm:openmeld@0.3.124", "cloudflare:core:111a0af1-1136-4486-a59b-67cb9c12ce01", "smoke:production-reconnect:d94d1786-9208-40d5-babe-3728b417b56b"]
---

Connecting a computer now finishes as soon as its OpenMeld Service is safely
running. Local Agents continue preparing in the background, setup commands stay
fresh while the Connect page is open, and OpenMeld automatically recovers more
stale Service installations without asking the user to diagnose them.
