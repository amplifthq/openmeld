---
id: local-cli-development-credentials
title: Keep local CLI sign-ins across macOS rebuilds
kind: improved
areas: ["cli", "service", "development"]
audiences: ["contributors"]
---

Isolated macOS localhost development now saves new CLI sign-ins in the existing
private-file store, so rebuilding the CLI or restarting the Service can reuse
the login without Keychain authorization. This lower-protection storage is for
test accounts only. Real-Keychain acceptance remains available with
`OPENMELD_DEV_CREDENTIAL_STORE=system` and a separate fresh development home.
