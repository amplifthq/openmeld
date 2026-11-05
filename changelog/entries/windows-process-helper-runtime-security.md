---
id: windows-process-helper-runtime-security
title: Update the Windows helper's bundled runtime
kind: security
areas: ["cli", "service", "windows"]
audiences: ["users", "contributors"]
---

The Windows process helper uses the patched .NET 10.0.14 runtime through SDK
10.0.403, addressing CVE-2026-111497. Build and release workflows use the same
pinned SDK and retain dependency vulnerability checks. The helper remains
self-contained, so users do not need to install .NET.
