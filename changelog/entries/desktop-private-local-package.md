---
id: desktop-private-local-package
title: Package the Desktop pilot with its shared pages
kind: improved
areas: ["desktop", "developer-workflow"]
audiences: ["contributors"]
---

Contributors can build a private unsigned macOS Apple Silicon Desktop app and
DMG containing the shared application pages. The package uses its own page
files and refuses missing or mismatched builds.
Pilot Web builds also reject a missing or invalid client Auth URL before
packaging, instead of producing a page that stops before sign-in appears.

The pilot still requires an existing aligned local Web, CLI, and Service lane.
It is not a public release or a clean-machine installer; signing and
authenticated packaged-app acceptance remain separate work.
