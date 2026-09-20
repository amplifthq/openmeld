---
id: cli-updates-retain-healthy-service
title: Keep a healthy Service during eligible CLI updates
kind: improved
areas: ["cli", "service"]
audiences: ["users"]
---

OpenMeld can update its managed CLI without replacing an already healthy
Service when the release explicitly selects the unchanged Service artifact.
Installation and repair also verify the actual package source before claiming
that a Service version was installed, so mismatched npm sources fail clearly
and leave the current Service untouched.
