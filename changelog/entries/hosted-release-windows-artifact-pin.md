---
id: hosted-release-windows-artifact-pin
title: Preserve the selected Windows helper during hosted CLI releases
kind: fixed
areas: ["releases", "cli"]
audiences: ["developers", "operators"]
---

Guarded hosted CLI releases now pass the selected Windows helper run to the
release workflow. This keeps publication tied to the helper bytes used to prepare
the release manifest, instead of building a replacement with different bytes.
