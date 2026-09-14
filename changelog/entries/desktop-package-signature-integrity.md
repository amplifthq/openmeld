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

Default development packages use ad-hoc signatures. An explicit local acceptance
command uses the existing Developer ID and Apple notarization credentials to
create a signed disk image containing a notarized app. It does not publish the
package. Normal macOS installation and startup still require separate acceptance.
