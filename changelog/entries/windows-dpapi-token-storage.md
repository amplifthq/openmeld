---
id: windows-dpapi-token-storage
title: Restore secure Windows CLI sign-in
kind: fixed
areas: ["cli", "authentication"]
audiences: ["users"]
publishedAt: 2026-09-16
release: v0.3.212
evidence: ["pr:1125", "pr:1133", "commit:b8dcd2b62dab99a9f852783550a913afe718abd4", "workflow:35136910148"]
---

The Windows CLI now loads the system encryption component before saving or
reading sign-in credentials. Credential-storage failures report a clear reason
and error code without exposing tokens or repeating the same error.
