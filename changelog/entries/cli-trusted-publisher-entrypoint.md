---
id: cli-trusted-publisher-entrypoint
title: Restore the trusted GitHub entrypoint for CLI releases
kind: fixed
areas: ["cli", "releases"]
audiences: ["operators", "contributors"]
---

The unified deploy command starts CLI publication through its established
GitHub workflow, preserving npm's trusted publishing identity. Releases keep
their source validation, signing, notarization, and installation checks, and
mixed releases wait for selected cloud components before publishing the CLI.
