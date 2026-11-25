---
id: computer-update-after-older-failure
title: Let Computers discover a newer release after an earlier update failed
kind: fixed
areas: ["computers", "core", "openmeld-service"]
audiences: ["members", "operators"]
---

A Computer with automatic updates enabled can receive a newer release while
the previous failed attempt is still visible. OpenMeld Service also reports
fresh component status when inspection finishes during a heartbeat, and logs
why component status was missing at registration.
