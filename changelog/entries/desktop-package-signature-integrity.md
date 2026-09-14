---
id: desktop-package-signature-integrity
title: Verify local Desktop package integrity
kind: fixed
areas: ["desktop", "developer-workflow"]
audiences: ["contributors"]
---

Local macOS Desktop builds now sign the complete app and verify its resources
before creating the disk image. Builds fail if signing is disabled instead of
producing an app with an incomplete signature.

These local signatures do not provide Developer ID trust or Apple notarization.
Normal macOS installation and startup still require separate acceptance.
