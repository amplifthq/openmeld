---
id: desktop-october-release
title: Desktop 0.1.15 for Mac and Windows preview
kind: improved
areas: ["desktop", "windows"]
audiences: ["users"]
publishedAt: 2026-10-01
release: v0.3.233
evidence: ["pr:1414", "commit:e4454cf165b96c7f918e420f28205c2b2ed3c575", "workflow:36828214503", "artifact:sha256:5e6df8f68fc4222f6f77237942c1258d3a7d124801e99761c35f85359ffb73cb", "artifact:sha256:924c9bd6d5168f08d9ad7f5f8078a10a144644165b2de6cd80243aad51c75d8b"]
---

Desktop 0.1.15 is available for Apple silicon Macs and as an internal Windows
x64 preview. Both include the latest Space, Inbox, and Team interface updates.
OpenMeld CLI and Service 0.3.233 are also available.

The Mac download is signed and notarized. An installed 0.1.14 app was upgraded
to 0.1.15 through its updater and restarted successfully.

The Windows installer is unsigned and has no automatic updates. Native package
and runtime checks passed; installed Windows GUI acceptance remains unverified.
An existing PowerShell task-host compatibility fixture still times out.

Download [Mac Desktop](https://openmeld.ai/desktop?platform=macos-arm64) or the
[Windows x64 internal preview](https://openmeld.ai/desktop?platform=windows-x64).
