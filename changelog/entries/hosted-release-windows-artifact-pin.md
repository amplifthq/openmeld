---
id: hosted-release-windows-artifact-pin
title: Preserve the selected Windows helper during hosted CLI releases
kind: fixed
areas: ["releases", "cli"]
audiences: ["developers", "operators"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1705", "workflow:38595947657", "workflow:38454720367"]
---

Guarded hosted CLI releases now pass the selected Windows helper run to the
release workflow. This keeps publication tied to the helper bytes used to prepare
the release manifest, instead of building a replacement with different bytes.
