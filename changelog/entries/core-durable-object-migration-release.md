---
id: core-durable-object-migration-release
title: Release Core updates that add Durable Objects
kind: fixed
areas: ["release", "core"]
audiences: ["operators", "contributors"]
---

Core releases handle Cloudflare's requirement to apply Durable Object class
changes atomically. The guarded release keeps startup validation and records
whether the version is uploaded or already serving traffic.

CLI release recovery uses current deployment controls with the original product
source, preserving published artifacts and channel verification.
