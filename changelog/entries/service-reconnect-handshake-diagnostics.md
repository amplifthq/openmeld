---
id: service-reconnect-handshake-diagnostics
title: Trace a Computer reconnect from handshake to registration
kind: improved
areas: ["computers", "core", "openmeld-service"]
audiences: ["operators"]
---

Operators can follow a Service connection attempt through Gateway and Core
when a Computer disappears. Updated Services link retries to the last
acknowledged socket, including attempts rejected before registration.
