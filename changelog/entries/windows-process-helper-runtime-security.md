---
id: windows-process-helper-runtime-security
title: Update the Windows helper's bundled runtime
kind: security
areas: ["cli", "service", "windows"]
audiences: ["users", "contributors"]
publishedAt: 2026-11-06
release: v0.3.291
evidence: ["pr:386", "pr:387", "commit:076d1a05ee9d262bf3166e5cf857dc19f13853f5", "workflow:42158332038"]
---

The Windows process helper uses the patched .NET 10.0.14 runtime through SDK
10.0.403, addressing CVE-2026-111497. Build and release workflows use the same
pinned SDK and retain dependency vulnerability checks. The helper remains
self-contained, so users do not need to install .NET.
