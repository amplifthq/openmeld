---
id: local-build-keychain-guidance
title: Clarify sign-in access after rebuilding the macOS CLI
kind: fixed
areas: ["cli", "development"]
audiences: ["contributors"]
---

The local binary server now warns that rebuilding an ad-hoc macOS CLI can
prevent it from reading a previous build's Keychain sign-in. Development
instructions explain how to sign in with the current build in the isolated
environment. Credential-read errors no longer promise that the problem is
temporary. Keychain access controls and background authorization behavior are
unchanged.
