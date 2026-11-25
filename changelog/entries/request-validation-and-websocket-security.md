---
id: request-validation-and-websocket-security
title: Limit memory use on oversized requests and fragmented WebSocket traffic
kind: security
areas: ["api", "cli", "service"]
audiences: ["members", "admins", "developers"]
---

OpenMeld rejects oversized Space Task project lists before validating each ID.
The Node.js WebSocket transport used by the CLI and local OpenMeld Service
limits incoming fragments and buffered chunks.
