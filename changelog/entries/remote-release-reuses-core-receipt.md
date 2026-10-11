---
id: remote-release-reuses-core-receipt
title: Release Remote Agent without repeating a completed Core deployment
kind: fixed
areas: ["releases"]
audiences: ["contributors"]
---

Remote Agent releases can reuse a verified Core receiver deployment for Space
Tasks and Center Agent evidence tools. Release admission still blocks missing
or unverified prerequisites, but no longer requires deploying Core again in
the same command.
