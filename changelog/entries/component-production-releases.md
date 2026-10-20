---
id: component-production-releases
title: Release selected production components from one command
kind: improved
areas: ["releases", "cli", "service"]
audiences: ["operators", "contributors"]
evidence: ["pr:238"]
---

Operators can select production components and run their release steps locally
or through GitHub Actions. CLI publication requires an explicit update policy
for each changed local component and publishes the policy after the artifacts
are available. Core reads the published policy without a separate Core release.
